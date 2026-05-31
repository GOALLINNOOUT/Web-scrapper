import { Types } from 'mongoose';
import type { JobType } from 'bullmq';
import { CrawlJob } from '../models/CrawlJob.js';
import { Page } from '../models/Page.js';
import type { QueueBundle } from '../queue/queues.js';
import { fetchPageResult } from '../crawler/fetchPage.js';
import { renderPageSnapshot } from '../crawler/renderPage.js';
import { isAllowedByRobots } from '../crawler/robots.js';
import { runExtractorPipeline } from '../extractors/pipeline.js';
import { isPrivateUrl } from '../middleware/ssrfProtection.js';
import { getCircuitBreaker } from '../utils/circuitBreaker.js';
import { domainFromUrl, isLikelyPageUrl, isSameDomain } from '../utils/url.js';
import { retentionDate } from '../utils/retention.js';
import { detectPageChanges } from './changeDetectionService.js';
import { rebuildDomainProfile } from '../intelligence/domain.service.js';
import type { CrawlConfig } from '../types.js';
import { createDailyEmailAlert } from './alertService.js';
import { updateCrawlSummaryForPage } from './crawlSummaryService.js';
import { invalidateCrawlReads, invalidateDomainReads } from './cacheInvalidation.js';
import { reserveCrawlUrls } from './urlDeduplicator.js';
import { waitForDomainTurn } from './domainThrottle.js';
import { incrementMetric, observeHistogram } from '../utils/metrics.js';
import { logger } from '../utils/logger.js';
import { crawlPageJobId, crawlRefreshJobId } from '../queue/jobIds.js';
import { publishLiveEvent } from './liveEvents.js';

export interface CrawlPageJobData {
  deviceId: string;
  crawlId: string;
  url: string;
  depth: number;
  parentUrl?: string | null;
  discoveredFrom?: string | null;
}

export async function processCrawlPage(data: CrawlPageJobData, queues?: QueueBundle, queueJobId = '') {
  const job = await CrawlJob.findOne({ _id: data.crawlId, deviceId: data.deviceId }).lean();
  if (!job) throw new Error('Crawl job not found');
  if (['completed', 'stopped', 'failed'].includes(job.status)) return { skipped: true, reason: job.status };
  if (job.requestedStop || job.status === 'stopped') {
    await CrawlJob.updateOne({ _id: data.crawlId, deviceId: data.deviceId }, {
      $set: { status: 'stopped', requestedPause: false, completedAt: new Date() }
    });
    return { skipped: true, reason: 'stopped' };
  }
  if (job.requestedPause || job.status === 'paused') {
    if (queues) {
      await queues.crawlPages.add('crawl-page', data, {
        delay: Number(process.env.PAUSED_CRAWL_RECHECK_MS || 5000),
        jobId: crawlPageJobId(data.crawlId, data.url, 'paused')
      }).catch(() => undefined);
    }
    return { skipped: true, reason: 'paused' };
  }
  if (job.status === 'queued') {
    await CrawlJob.updateOne({ _id: data.crawlId }, { $set: { status: 'running', startedAt: new Date() } });
  }

  const config = job.config as unknown as CrawlConfig;
  if ((job.pagesCrawled || 0) >= config.maxPages) {
    await completeCrawlIfNeeded(data.deviceId, data.crawlId, job.seedUrl);
    return { skipped: true, reason: 'max_pages' };
  }
  if (data.depth > config.maxDepth) {
    await maybeCompleteCrawl(data.deviceId, data.crawlId, queues, queueJobId);
    return { skipped: true, reason: 'max_depth' };
  }
  if (await isPrivateUrl(data.url)) throw new Error(`SSRF_BLOCKED: ${data.url}`);

  const domain = domainFromUrl(data.url);
  const breaker = getCircuitBreaker(domain);
  if (breaker.isOpen()) return { skipped: true, reason: 'circuit_open' };
  if (!(await isAllowedByRobots(data.url, config.respectRobots))) {
    await maybeCompleteCrawl(data.deviceId, data.crawlId, queues, queueJobId);
    return { skipped: true, reason: 'robots_disallowed' };
  }

  try {
    const releaseDomainSlot = await waitForDomainTurn(domain);
    const fetchStarted = process.hrtime.bigint();
    let result: Awaited<ReturnType<typeof fetchPageResult>>;
    try {
      result = await fetchPageResult(data.url, 2);
    } finally {
      await releaseDomainSlot();
      observeHistogram('webintel_fetch_duration_seconds', 'HTTP page fetch duration in seconds', Number(process.hrtime.bigint() - fetchStarted) / 1_000_000_000, { domain });
    }
    const latestJob = await CrawlJob.findOne({ _id: data.crawlId, deviceId: data.deviceId }, { requestedStop: 1, requestedPause: 1, status: 1 }).lean();
    if (latestJob?.requestedStop || latestJob?.status === 'stopped') {
      await CrawlJob.updateOne({ _id: data.crawlId, deviceId: data.deviceId }, {
        $set: { status: 'stopped', requestedPause: false, completedAt: new Date() }
      });
      return { skipped: true, reason: 'stopped_after_fetch' };
    }
    if (latestJob?.requestedPause || latestJob?.status === 'paused') {
      if (queues) {
        await queues.crawlPages.add('crawl-page', data, {
          delay: Number(process.env.PAUSED_CRAWL_RECHECK_MS || 5000),
          jobId: crawlPageJobId(data.crawlId, data.url, 'paused')
        }).catch(() => undefined);
      }
      return { skipped: true, reason: 'paused_after_fetch' };
    }
    const finalUrl = result.finalUrl || data.url;
    let extracted = await runExtractorPipeline(result.html, finalUrl, result.headers, {
      includeMetaLinks: config.discovery.includeMetaLinks
    });

    let renderUsed = false;
    if (shouldRenderFallback(config, extracted.links.length)) {
      const renderedSnapshot = await renderPageSnapshot(finalUrl);
      if (renderedSnapshot) {
        renderUsed = true;
        const rendered = await runExtractorPipeline(renderedSnapshot.html, finalUrl, result.headers, {
          includeMetaLinks: config.discovery.includeMetaLinks
        });
        extracted = {
          ...rendered,
          links: [...new Set([...extracted.links, ...rendered.links])],
          techStack: [...new Set([...extracted.techStack, ...rendered.techStack, ...renderedSnapshot.techStack])].sort()
        };
      }
    }
    incrementMetric('webintel_page_fetch_mode_total', 'Total crawled pages by fetch mode', { mode: renderUsed ? 'http_plus_render' : 'http_only' });
    breaker.recordSuccess();

    const reservedJob = await CrawlJob.findOneAndUpdate(
      {
        _id: data.crawlId,
        deviceId: data.deviceId,
        status: { $nin: ['completed', 'stopped', 'failed', 'paused'] },
        requestedStop: { $ne: true },
        requestedPause: { $ne: true },
        pagesCrawled: { $lt: config.maxPages }
      },
      {
        $inc: {
          pagesCrawled: 1,
          emailsFound: extracted.emails.length,
          socialLinksFound: new Set(Object.values(extracted.social).flat()).size
        }
      },
      { new: true }
    ).lean();

    if (!reservedJob) {
      await completeCrawlIfNeeded(data.deviceId, data.crawlId, job.seedUrl);
      return { skipped: true, reason: 'max_pages_or_inactive' };
    }

    const page = await Page.findOneAndUpdate(
      { deviceId: data.deviceId, crawlId: data.crawlId, url: data.url },
      {
        $set: {
          deviceId: data.deviceId,
          workspaceId: data.deviceId,
          crawlId: new Types.ObjectId(data.crawlId),
          url: data.url,
          domain,
          depth: data.depth,
          parentUrl: data.parentUrl || null,
          parentPageId: data.discoveredFrom || null,
          discoveredFrom: data.parentUrl || null,
          metadata: extracted.metadata,
          links: extracted.links,
          emails: extracted.emails,
          social: extracted.social,
          techStack: extracted.techStack,
          content: extracted.content,
          classification: extracted.classification,
          score: extracted.score,
          searchText: buildSearchText(data.url, domain, extracted),
          crawledAt: new Date(),
          expiresAt: retentionDate(),
          contentHash: extracted.contentHash,
          status: 'crawled'
        }
      },
      { upsert: true, new: true }
    );

    if (extracted.emails.length > 0) {
      await createDailyEmailAlert({
        deviceId: data.deviceId,
        domain,
        crawlId: data.crawlId,
        pageUrl: data.url,
        emails: extracted.emails
      }).catch(() => undefined);
    }

    await updateCrawlSummaryForPage({
      deviceId: data.deviceId,
      crawlId: data.crawlId,
      pageUrl: data.url,
      emails: extracted.emails,
      social: extracted.social as unknown as Record<string, string[] | undefined>,
      techStack: extracted.techStack
    }).catch(() => undefined);

    await detectPageChanges({
      deviceId: data.deviceId,
      workspaceId: data.deviceId,
      url: data.url,
      crawlId: data.crawlId,
      contentHash: extracted.contentHash
    });

    if (queues && reservedJob.pagesCrawled < config.maxPages && data.depth < config.maxDepth && config.extract.links) {
      const candidates = extracted.links
        .filter((link) => isLikelyPageUrl(link))
        .filter((link) => !config.sameDomainOnly || isSameDomain(link, job.seedUrl))
        .slice(0, 100);

      const freshCandidates = await reserveCrawlUrls(data.crawlId, candidates);
      const existing = await Page.find({ deviceId: data.deviceId, crawlId: data.crawlId, url: { $in: freshCandidates } }, { url: 1 }).lean();
      const known = new Set(existing.map((item) => item.url));
      const linkJobs = freshCandidates
        .filter((link) => !known.has(link))
        .map((link) => ({
          name: 'crawl-page',
          data: { deviceId: data.deviceId, crawlId: data.crawlId, url: link, depth: data.depth + 1, parentUrl: data.url, discoveredFrom: page._id.toString() },
          opts: { jobId: crawlPageJobId(data.crawlId, link) }
        }));

      if (linkJobs.length > 0) {
        await queues.crawlPages.addBulk(linkJobs);
        incrementMetric('webintel_links_discovered_total', 'Total crawl links queued', { domain }, linkJobs.length);
      }
    }

    await invalidateCrawlReads(data.deviceId, data.crawlId, { publish: false }).catch(() => undefined);
    await publishLiveEvent({
      type: 'crawl.page',
      deviceId: data.deviceId,
      crawlId: data.crawlId,
      data: {
        page: toLivePage(page),
        job: {
          pagesCrawled: reservedJob.pagesCrawled || 0,
          emailsFound: reservedJob.emailsFound || 0,
          socialLinksFound: reservedJob.socialLinksFound || 0,
          status: reservedJob.status
        }
      }
    }).catch(() => undefined);
    await maybeCompleteCrawl(data.deviceId, data.crawlId, queues, queueJobId);
    incrementMetric('webintel_pages_crawled_total', 'Total pages processed by crawl workers', { status: 'crawled', page_type: extracted.classification.pageType });
    logger.info({ deviceId: data.deviceId, crawlId: data.crawlId, domain, url: data.url, queuedLinks: queues ? undefined : 0 }, 'Crawl page processed');
    return { success: true, url: data.url, score: extracted.score };
  } catch (error) {
    breaker.recordFailure();
    const message = error instanceof Error ? error.message : 'Unknown crawl page failure';
    incrementMetric('webintel_pages_crawled_total', 'Total pages processed by crawl workers', { status: 'failed', page_type: 'failed' });
    logger.warn({ deviceId: data.deviceId, crawlId: data.crawlId, domain, url: data.url, err: message }, 'Crawl page failed');
    await Page.findOneAndUpdate(
      { deviceId: data.deviceId, crawlId: data.crawlId, url: data.url },
      {
        $set: {
          deviceId: data.deviceId,
          workspaceId: data.deviceId,
          crawlId: data.crawlId,
          url: data.url,
          domain,
          depth: data.depth,
          parentUrl: data.parentUrl || null,
          links: [],
          emails: [],
          social: {},
          techStack: [],
          content: { text: '', headings: [], paragraphs: [], wordCount: 0 },
          classification: { pageType: 'failed', confidence: 1 },
          score: 0,
          searchText: `${data.url} ${domain} fetch failed ${message}`,
          crawledAt: new Date(),
          expiresAt: retentionDate(),
          contentHash: message,
          status: 'failed'
        }
      },
      { upsert: true, new: true }
    );
    return { failed: true, url: data.url, error: message };
  }
}

export function shouldRenderFallback(config: CrawlConfig, staticLinkCount: number) {
  return Boolean(
    config.extract.links
    && config.discovery.renderJavaScript
    && staticLinkCount < config.discovery.renderWhenStaticLinksBelow
  );
}

async function maybeCompleteCrawl(deviceId: string, crawlId: string, queues?: QueueBundle, queueJobId = '') {
  if (queues) {
    await queues.domainEnrichment.add('refresh-domain-after-page', { deviceId, domain: undefined, crawlId }, {
      delay: 10_000,
      jobId: crawlRefreshJobId(crawlId),
      attempts: 2
    }).catch(() => undefined);
  }

  const job = await CrawlJob.findOne({ _id: crawlId, deviceId }).lean();
  if (!job) return;
  if (job.requestedStop || job.requestedPause || ['stopped', 'paused', 'failed'].includes(job.status)) return;
  if ((job.pagesCrawled || 0) >= (job.config as unknown as CrawlConfig).maxPages) {
    await completeCrawlIfNeeded(deviceId, crawlId, job.seedUrl);
    return;
  }

  if (queues) {
    const hasRemaining = await hasRemainingCrawlPageJobs(queues, crawlId, queueJobId);
    if (!hasRemaining && (job.pagesCrawled || 0) > 0) {
      await completeCrawlIfNeeded(deviceId, crawlId, job.seedUrl);
    }
  }
}

async function hasRemainingCrawlPageJobs(queues: QueueBundle, crawlId: string, queueJobId: string) {
  const states: JobType[] = ['waiting', 'delayed', 'prioritized', 'active'];
  const pageSize = 1000;
  for (let start = 0; start < 10_000; start += pageSize) {
    const jobs = await queues.crawlPages.getJobs(states, start, start + pageSize - 1, true);
    if (jobs.length === 0) return false;
    if (jobs.some((pageJob) => String(pageJob.id || '') !== queueJobId && String(pageJob.data?.crawlId || '') === crawlId)) return true;
    if (jobs.length < pageSize) return false;
  }
  return true;
}

async function completeCrawlIfNeeded(deviceId: string, crawlId: string, seedUrl: string) {
  const completed = await CrawlJob.findOneAndUpdate(
    {
      _id: crawlId,
      deviceId,
      status: { $nin: ['completed', 'stopped', 'failed', 'paused'] },
      requestedStop: { $ne: true },
      requestedPause: { $ne: true }
    },
    { $set: { status: 'completed', requestedPause: false, completedAt: new Date() } },
    { new: true }
  ).lean();

  if (completed) {
    await publishLiveEvent({
      type: 'crawl.updated',
      deviceId,
      crawlId,
      data: {
        job: {
          status: completed.status,
          pagesCrawled: completed.pagesCrawled || 0,
          emailsFound: completed.emailsFound || 0,
          socialLinksFound: completed.socialLinksFound || 0
        }
      }
    }).catch(() => undefined);
    await rebuildDomainProfile(deviceId, domainFromUrl(seedUrl)).catch(() => undefined);
    await invalidateDomainReads(deviceId).catch(() => undefined);
  }
}

function buildSearchText(url: string, domain: string, extracted: Awaited<ReturnType<typeof runExtractorPipeline>>) {
  return [
    url,
    domain,
    ...Object.values(extracted.metadata).filter(Boolean).map(String),
    ...extracted.emails,
    ...extracted.links,
    ...Object.values(extracted.social).flat(),
    ...extracted.techStack,
    extracted.content.text,
    extracted.classification.pageType
  ].join(' ');
}

function toLivePage(page: { toObject?: () => Record<string, unknown> }) {
  const value = typeof page.toObject === 'function' ? page.toObject() : page as Record<string, unknown>;
  return {
    ...value,
    _id: String(value._id || ''),
    crawlId: String(value.crawlId || ''),
    parentPageId: value.parentPageId ? String(value.parentPageId) : null
  };
}
