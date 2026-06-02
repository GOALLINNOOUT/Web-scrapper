import { CrawlJob } from '../models/CrawlJob.js';
import { MonitoringProfile } from '../models/MonitoringProfile.js';
import { withCrawlConfigDefaults } from '../crawler/config.js';
import type { QueueBundle } from '../queue/queues.js';
import { crawlPageJobId } from '../queue/jobIds.js';
import { retentionDate } from '../utils/retention.js';
import { logger } from '../utils/logger.js';
import { invalidateWorkspaceReads } from './cacheInvalidation.js';
import { getWorkspaceSettings } from './workspaceSettingsService.js';
import { isPrivateUrl } from '../middleware/ssrfProtection.js';

const scheduleDurationsMs = {
  '12h': 12 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000
} as const;

type MonitoringSchedule = keyof typeof scheduleDurationsMs;

export async function enqueueDueMonitoringChecks(queues: QueueBundle, now = new Date()) {
  const oldestDue = new Date(now.getTime() - scheduleDurationsMs.monthly);
  const profiles = await MonitoringProfile.find({
    enabled: true,
    $or: [
      { lastCheckedAt: null },
      { lastCheckedAt: { $lte: oldestDue } },
      { schedule: 'weekly', lastCheckedAt: { $lte: new Date(now.getTime() - scheduleDurationsMs.weekly) } },
      { schedule: 'daily', lastCheckedAt: { $lte: new Date(now.getTime() - scheduleDurationsMs.daily) } },
      { schedule: '12h', lastCheckedAt: { $lte: new Date(now.getTime() - scheduleDurationsMs['12h']) } }
    ]
  }).limit(500).lean();

  let queued = 0;
  for (const profile of profiles) {
    const schedule = (profile.schedule || 'daily') as MonitoringSchedule;
    if (!isDue(profile.lastCheckedAt || null, schedule, now)) continue;

    const slot = Math.floor(now.getTime() / scheduleDurationsMs[schedule]);
    await queues.monitoringChecks.add(
      'run-monitoring-check',
      { profileId: profile._id.toString(), deviceId: profile.deviceId },
      {
        jobId: `monitoring:${profile._id.toString()}:${slot}`,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 500,
        removeOnFail: 1000
      }
    ).then(() => {
      queued += 1;
    }).catch((error) => {
      logger.warn({ profileId: profile._id.toString(), error: error.message }, 'Unable to enqueue monitoring check');
    });
  }

  return { scanned: profiles.length, queued };
}

export async function processMonitoringCheck(data: { profileId?: string; deviceId?: string }, queues: QueueBundle) {
  const profileId = String(data.profileId || '');
  const deviceId = String(data.deviceId || '');
  if (!profileId || !deviceId) throw new Error('Missing monitoring profile payload');

  const profile = await MonitoringProfile.findOne({ _id: profileId, deviceId, enabled: true });
  if (!profile) return { skipped: true, reason: 'profile_not_found' };

  const pages = (profile.monitoredPages || [])
    .filter((page) => page.enabled !== false)
    .map((page) => page.url)
    .filter(Boolean);
  const urls = [...new Set(pages.length > 0 ? pages : [profile.seedUrl])];
  if (urls.length === 0) return { skipped: true, reason: 'no_urls' };

  const safetyChecks = await Promise.all(urls.map(async (url) => ({ url, blocked: await isPrivateUrl(url) })));
  const safeUrls = safetyChecks.filter((check) => !check.blocked).map((check) => check.url);
  const blockedUrls = safetyChecks.filter((check) => check.blocked).map((check) => check.url);
  if (safeUrls.length === 0) {
    await MonitoringProfile.updateOne(
      { _id: profile._id, deviceId },
      { $set: { enabled: false, lastCheckedAt: new Date() } }
    );
    await invalidateWorkspaceReads(deviceId).catch(() => undefined);
    logger.warn({ profileId, domain: profile.domain, blockedUrls }, 'Disabled monitoring profile with unsafe targets');
    return { skipped: true, reason: 'unsafe_targets' };
  }

  const settings = await getWorkspaceSettings(deviceId).catch(() => null);
  const crawling = settings?.crawling as { respectRobots?: boolean } | undefined;
  const config = withCrawlConfigDefaults({
    seedUrl: profile.seedUrl,
    maxPages: safeUrls.length,
    maxDepth: 0,
    sameDomainOnly: true,
    respectRobots: crawling?.respectRobots || false,
    concurrency: Math.min(10, Math.max(1, safeUrls.length)),
    schedule: 'none',
    discovery: {
      sitemap: false,
      renderJavaScript: true,
      renderWhenStaticLinksBelow: 20,
      includeMetaLinks: true
    },
    extract: { links: true, emails: true, metadata: true, social: true, content: true }
  });

  const crawl = await CrawlJob.create({
    deviceId,
    seedUrl: profile.seedUrl,
    config,
    status: 'running',
    startedAt: new Date(),
    expiresAt: retentionDate()
  });

  await queues.crawlPages.addBulk(safeUrls.map((url) => ({
    name: 'crawl-page',
    data: {
      deviceId,
      crawlId: crawl._id.toString(),
      url,
      depth: 0,
      parentUrl: null,
      discoveredFrom: null
    },
    opts: { jobId: crawlPageJobId(crawl._id.toString(), url) }
  })));

  const checkedAt = new Date();
  const update: Record<string, Date> = { lastCheckedAt: checkedAt };
  if ((profile.monitoredPages || []).length > 0) {
    update['monitoredPages.$[].lastCheckedAt'] = checkedAt;
  }
  await MonitoringProfile.updateOne({ _id: profile._id, deviceId }, { $set: update });
  await invalidateWorkspaceReads(deviceId).catch(() => undefined);

  logger.info({ profileId, crawlId: crawl._id.toString(), urls: safeUrls.length, blockedUrls: blockedUrls.length }, 'Queued monitoring crawl');
  return { crawlId: crawl._id.toString(), urls: safeUrls.length, blockedUrls: blockedUrls.length };
}

function isDue(lastCheckedAt: Date | null, schedule: MonitoringSchedule, now: Date) {
  if (!lastCheckedAt) return true;
  return now.getTime() - new Date(lastCheckedAt).getTime() >= scheduleDurationsMs[schedule];
}
