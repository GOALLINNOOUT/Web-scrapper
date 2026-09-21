import { Worker } from 'bullmq';
import { enrichDomain } from '../intelligence/domain.service.js';
import { redisConnection } from './connection.js';
import { queueNames, type QueueBundle } from './queues.js';
import { config } from '../config/index.js';
import { CrawlJob } from '../models/CrawlJob.js';
import { processCrawlPage } from '../services/crawlPageProcessor.js';
import { enqueueDueMonitoringChecks, processMonitoringCheck } from '../services/monitoringSchedulerService.js';
import { discoverSitemapUrls } from '../crawler/sitemap.js';
import { withCrawlConfigDefaults } from '../crawler/config.js';
import type { CrawlConfig } from '../types.js';
import { domainFromUrl, isLikelyPageUrl, isSameDomain } from '../utils/url.js';
import { logger } from '../utils/logger.js';
import { invalidateCrawlReads, invalidateDomainReads } from '../services/cacheInvalidation.js';
import { reserveCrawlUrls } from '../services/urlDeduplicator.js';
import { incrementMetric, setGauge } from '../utils/metrics.js';
import { crawlPageJobId } from './jobIds.js';
import { recordFailureEvent } from '../services/metricsCollector.js';
import { DISABLE_METRICS } from '../utils/featureFlags.js';

export interface WorkerBundle {
  crawlWorker: Worker;
  crawlPageWorker: Worker;
  monitoringWorker: Worker;
  domainWorker: Worker;
  close: () => Promise<void>;
}

const workerLockOptions = {
  lockDuration: Number(process.env.BULLMQ_LOCK_DURATION_MS || 300_000),
  stalledInterval: Number(process.env.BULLMQ_STALLED_INTERVAL_MS || 60_000),
  maxStalledCount: Number(process.env.BULLMQ_MAX_STALLED_COUNT || 1)
};

export function startQueueWorkers(queues: QueueBundle): WorkerBundle {
  const connection = redisConnection() as never;
  const crawlWorker = new Worker(
    queueNames.crawlJobs,
    async (job) => {
      const crawlId = String(job.data?.crawlId || '');
      const deviceId = String(job.data?.deviceId || '');
      if (!crawlId) throw new Error('Missing crawlId');
      const crawl = await CrawlJob.findOneAndUpdate(
        { _id: crawlId, ...(deviceId ? { deviceId } : {}) },
        { $set: { status: 'running', startedAt: new Date(), error: null } },
        { new: true }
      ).lean();
      if (!crawl) throw new Error('Crawl job not found');
      await invalidateCrawlReads(crawl.deviceId, crawlId).catch(() => undefined);
      const crawlConfig = withCrawlConfigDefaults({
        ...(crawl.config as unknown as Partial<CrawlConfig>),
        seedUrl: crawl.seedUrl
      } as CrawlConfig);
      const sitemapLinks = crawlConfig.extract.links && crawlConfig.discovery.sitemap && crawlConfig.maxDepth > 0
        ? await discoverSitemapUrls(crawl.seedUrl, Math.max(0, Math.min(crawlConfig.maxPages - 1, 250))).catch(() => [])
        : [];
      const scopedSitemapLinks = sitemapLinks
        .filter((link) => isLikelyPageUrl(link))
        .filter((link) => !crawlConfig.sameDomainOnly || isSameDomain(link, crawl.seedUrl));
      const reservedUrls = await reserveCrawlUrls(crawlId, [crawl.seedUrl, ...scopedSitemapLinks]).catch(() => [crawl.seedUrl]);
      const pageJobs = reservedUrls.map((url) => ({
        name: 'crawl-page',
        data: {
          deviceId: crawl.deviceId,
          crawlId,
          url,
          depth: url === crawl.seedUrl ? 0 : 1,
          parentUrl: url === crawl.seedUrl ? null : crawl.seedUrl,
          discoveredFrom: null
        },
        opts: { jobId: crawlPageJobId(crawlId, url) }
      }));

      await queues.crawlPages.addBulk(pageJobs.length > 0 ? pageJobs : [{
        name: 'crawl-page',
        data: {
        deviceId: crawl.deviceId,
        crawlId,
        url: crawl.seedUrl,
        depth: 0,
        parentUrl: null,
        discoveredFrom: null
        },
        opts: { jobId: crawlPageJobId(crawlId, crawl.seedUrl) }
      }]);
      logger.info({ crawlId, deviceId: crawl.deviceId, queuedPages: pageJobs.length, sitemapLinks: scopedSitemapLinks.length }, 'Queued crawl pages');
      return { crawlId, queuedPages: pageJobs.length };
    },
    {
      connection,
      concurrency: config.crawlJobWorkerConcurrency,
      ...workerLockOptions
    }
  );

  const crawlPageWorker = new Worker(
    queueNames.crawlPages,
    async (job) => processCrawlPage(job.data, queues, String(job.id || '')),
    {
      connection,
      concurrency: config.crawlPageWorkerConcurrency,
      ...workerLockOptions,
      limiter: {
        max: config.crawlPageWorkerRate,
        duration: 1000
      }
    }
  );

  const monitoringWorker = new Worker(
    queueNames.monitoringChecks,
    async (job) => processMonitoringCheck(job.data, queues),
    {
      connection,
      concurrency: config.monitoringChecksConcurrency,
      ...workerLockOptions
    }
  );

  const domainWorker = new Worker(
    queueNames.domainEnrichment,
    async (job) => {
      const deviceId = String(job.data?.deviceId || '');
      let domain = String(job.data?.domain || '');
      const force = Boolean(job.data?.force);
      const crawlId = String(job.data?.crawlId || '');
      if (!domain && crawlId) {
        const crawl = await CrawlJob.findOne({ _id: crawlId, deviceId }).lean();
        domain = crawl ? domainFromUrl(crawl.seedUrl) : '';
      }
      if (!deviceId || !domain) throw new Error('Missing domain enrichment payload');
      const profile = await enrichDomain(deviceId, domain, force);
      await invalidateDomainReads(deviceId).catch(() => undefined);
      return { domain: profile?.domain || domain };
    },
    {
      connection,
      concurrency: config.domainEnrichmentConcurrency,
      ...workerLockOptions
    }
  );

  crawlWorker.on('failed', async (job, error) => {
    logger.error({ jobId: job?.id, err: error.message }, 'Crawl queue job failed');
    incrementMetric('webintel_queue_jobs_failed_total', 'Total failed BullMQ jobs', { queue: queueNames.crawlJobs });
    if (!DISABLE_METRICS) await recordFailureEvent({ jobId: String(job?.id || ''), workerId: 'crawl-jobs', error, retryCount: job?.attemptsMade || 0, isTerminal: true }).catch(() => undefined);
  });
  crawlPageWorker.on('failed', async (job, error) => {
    logger.error({ jobId: job?.id, crawlId: job?.data?.crawlId, deviceId: job?.data?.deviceId, domain: safeDomain(job?.data?.url), err: error.message }, 'Crawl page job failed');
    incrementMetric('webintel_queue_jobs_failed_total', 'Total failed BullMQ jobs', { queue: queueNames.crawlPages });
    if (!DISABLE_METRICS) await recordFailureEvent({ jobId: String(job?.id || ''), workerId: 'crawl-pages', error, retryCount: job?.attemptsMade || 0, isTerminal: true, url: String(job?.data?.url || '') }).catch(() => undefined);
    const crawlId = String(job?.data?.crawlId || '');
    if (crawlId) {
      await CrawlJob.updateOne({ _id: crawlId, pagesCrawled: 0 }, {
        $set: { status: 'failed', error: error.message, deadLetterReason: error.message, completedAt: new Date() }
      }).catch(() => undefined);
    }
  });
  monitoringWorker.on('failed', async (job, error) => {
    logger.error({ jobId: job?.id, profileId: job?.data?.profileId, deviceId: job?.data?.deviceId, err: error.message }, 'Monitoring check job failed');
    incrementMetric('webintel_queue_jobs_failed_total', 'Total failed BullMQ jobs', { queue: queueNames.monitoringChecks });
    if (!DISABLE_METRICS) await recordFailureEvent({ jobId: String(job?.id || ''), workerId: 'monitoring-checks', error, retryCount: job?.attemptsMade || 0, isTerminal: true }).catch(() => undefined);
  });
  domainWorker.on('failed', async (job, error) => {
    logger.error({ jobId: job?.id, err: error.message }, 'Domain enrichment job failed');
    incrementMetric('webintel_queue_jobs_failed_total', 'Total failed BullMQ jobs', { queue: queueNames.domainEnrichment });
    if (!DISABLE_METRICS) await recordFailureEvent({ jobId: String(job?.id || ''), workerId: 'domain-enrichment', domain: String(job?.data?.domain || ''), error, retryCount: job?.attemptsMade || 0, isTerminal: true }).catch(() => undefined);
  });

  const metricsTimer = setInterval(() => {
    void Promise.all([
      updateQueueDepthMetric(queues, 'crawl-jobs', queueNames.crawlJobs),
      updateQueueDepthMetric(queues, 'crawl-pages', queueNames.crawlPages),
      updateQueueDepthMetric(queues, 'monitoring-checks', queueNames.monitoringChecks),
      updateQueueDepthMetric(queues, 'domain-enrichment', queueNames.domainEnrichment)
    ]);
  }, 10_000);
  metricsTimer.unref();

  const monitoringSchedulerTimer = setInterval(() => {
    void enqueueDueMonitoringChecks(queues).then((result) => {
      if (result.queued > 0) logger.info(result, 'Queued due monitoring checks');
    }).catch((error) => {
      logger.warn({ err: error.message }, 'Monitoring scheduler scan failed');
    });
  }, config.monitoringSchedulerIntervalMs);
  monitoringSchedulerTimer.unref();
  void enqueueDueMonitoringChecks(queues).catch((error) => {
    logger.warn({ err: error.message }, 'Initial monitoring scheduler scan failed');
  });

  return {
    crawlWorker,
    crawlPageWorker,
    monitoringWorker,
    domainWorker,
    close: async () => {
      await Promise.all([crawlWorker.close(), crawlPageWorker.close(), monitoringWorker.close(), domainWorker.close()]);
      clearInterval(metricsTimer);
      clearInterval(monitoringSchedulerTimer);
    }
  };
}

async function updateQueueDepthMetric(queues: QueueBundle, label: string, name: string) {
  const queue = Object.values(queues).find((item) => item.name === name);
  if (!queue) return;
  const counts = await queue.getJobCounts('waiting', 'delayed', 'active');
  setGauge('webintel_queue_depth', 'Current BullMQ job queue depth', { queue: label }, (counts.waiting || 0) + (counts.delayed || 0) + (counts.active || 0));
}

function safeDomain(value: unknown) {
  if (typeof value !== 'string') return '';
  try {
    return domainFromUrl(value);
  } catch {
    return '';
  }
}
