import { Queue } from 'bullmq';
import { redisConnection } from './connection.js';

export const queueNames = {
  crawlJobs: 'crawl-jobs',
  crawlPagesHigh: 'crawl-pages-high',
  crawlPages: 'crawl-pages',
  crawlPagesLow: 'crawl-pages-low',
  monitoringChecks: 'monitoring-checks',
  changeDetection: 'change-detection',
  domainEnrichment: 'domain-enrichment',
  webhooks: 'webhooks',
  alerts: 'alerts'
} as const;

export function createQueues() {
  const connection = redisConnection() as never;
  const defaultJobOptions = {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 2000 },
    removeOnComplete: { count: 1000, age: 3600 },
    removeOnFail: { count: 5000 }
  };

  return {
    crawlJobs: new Queue(queueNames.crawlJobs, { connection, defaultJobOptions }),
    crawlPagesHigh: new Queue(queueNames.crawlPagesHigh, { connection, defaultJobOptions }),
    crawlPages: new Queue(queueNames.crawlPages, { connection, defaultJobOptions }),
    crawlPagesLow: new Queue(queueNames.crawlPagesLow, { connection, defaultJobOptions }),
    monitoringChecks: new Queue(queueNames.monitoringChecks, { connection, defaultJobOptions }),
    changeDetection: new Queue(queueNames.changeDetection, { connection, defaultJobOptions }),
    domainEnrichment: new Queue(queueNames.domainEnrichment, { connection, defaultJobOptions }),
    webhooks: new Queue(queueNames.webhooks, { connection, defaultJobOptions }),
    alerts: new Queue(queueNames.alerts, { connection, defaultJobOptions })
  };
}

export type QueueBundle = ReturnType<typeof createQueues>;
