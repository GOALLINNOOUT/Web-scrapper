import dotenv from 'dotenv';

dotenv.config();

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  mongodbUri: process.env.MONGODB_URI || '',
  mongodbStorageLimitMb: clamp(process.env.MONGODB_STORAGE_LIMIT_MB, 1, 1024 * 1024, 512),
  redisUrl: process.env.REDIS_URL || '',
  performanceMode: process.env.PERFORMANCE_MODE || 'development',
  targetCrawlPagesPerSecond: clamp(process.env.TARGET_CRAWL_PAGES_PER_SECOND, 1, 100_000, 50),
  webWorkers: clamp(process.env.WEB_WORKERS, 1, 64, 0),
  crawlJobWorkerConcurrency: clamp(process.env.CRAWL_JOB_WORKER_CONCURRENCY, 1, 50, 4),
  crawlPageWorkerConcurrency: clamp(process.env.CRAWL_PAGE_WORKER_CONCURRENCY || process.env.WORKER_CONCURRENCY, 1, 1000, 25),
  crawlPageWorkerRate: clamp(process.env.CRAWL_PAGE_WORKER_RATE, 1, 100_000, 25),
  crawlerUserAgent: process.env.CRAWLER_USER_AGENT || 'WebIntelligenceCrawler/1.0',
  crawlerUserAgentPool: parseList(process.env.CRAWLER_USER_AGENT_POOL),
  crawlerProxyUrls: parseList(process.env.CRAWLER_PROXY_URLS),
  crawlerMaxContentBytes: clamp(process.env.CRAWLER_MAX_CONTENT_BYTES, 1024 * 128, 1024 * 1024 * 100, 2 * 1024 * 1024),
  crawlerRespectRobots: process.env.CRAWLER_RESPECT_ROBOTS === 'true',
  crawlerDomainConcurrency: clamp(process.env.CRAWLER_DOMAIN_CONCURRENCY, 1, 1000, 4),
  crawlerDomainRatePerSecond: clamp(process.env.CRAWLER_DOMAIN_RATE_PER_SECOND, 1, 10_000, 5),
  crawlerRenderConcurrency: clamp(process.env.CRAWLER_RENDER_CONCURRENCY, 0, 500, 1),
  crawlerRenderRate: clamp(process.env.CRAWLER_RENDER_RATE, 1, 10_000, 2),
  crawlerRenderTimeoutMs: clamp(process.env.CRAWLER_RENDER_TIMEOUT_MS, 1_000, 120_000, 15_000),
  crawlerRenderQueueMax: clamp(process.env.CRAWLER_RENDER_QUEUE_MAX, 0, 100_000, 50),
  crawlerBlockRenderAssets: process.env.CRAWLER_BLOCK_RENDER_ASSETS !== 'false',
  monitoringEncryptionKey: process.env.MONITORING_ENCRYPTION_KEY || '',
  domainEnrichmentConcurrency: clamp(process.env.DOMAIN_ENRICHMENT_CONCURRENCY, 1, 50, 4),
  monitoringChecksConcurrency: clamp(process.env.MONITORING_CHECKS_CONCURRENCY, 1, 100, 4),
  monitoringSchedulerIntervalMs: clamp(process.env.MONITORING_SCHEDULER_INTERVAL_MS, 5_000, 3_600_000, 60_000),
  maxCrawlDepth: clamp(process.env.MAX_CRAWL_DEPTH, 0, 10, 10),
  maxPagesPerJob: clamp(process.env.MAX_PAGES_PER_JOB, 1, 100_000, 10_000),
  dataRetentionDays: clamp(process.env.DATA_RETENTION_DAYS, 1, 365, 90),
  rateLimitWindowMs: clamp(process.env.RATE_LIMIT_WINDOW_MS, 1_000, 600_000, 60_000),
  rateLimitDefault: clamp(process.env.RATE_LIMIT_DEFAULT, 10, 100_000, 100),
  rateLimitPro: clamp(process.env.RATE_LIMIT_PRO, 10, 500_000, 1000),
  rateLimitEnterprise: clamp(process.env.RATE_LIMIT_ENTERPRISE, 10, 2_000_000, 10_000),
  cacheTtlMonitoringMs: clamp(process.env.CACHE_TTL_MONITORING_MS, 0, 60_000, 15_000),
  cacheTtlCrawlMs: clamp(process.env.CACHE_TTL_CRAWL_MS, 0, 60_000, 15_000),
  cacheTtlDataMs: clamp(process.env.CACHE_TTL_DATA_MS, 0, 300_000, 30_000),
  cacheTtlDomainMs: clamp(process.env.CACHE_TTL_DOMAIN_MS, 0, 300_000, 60_000),
  cacheTtlMetadataPreviewMs: clamp(process.env.CACHE_TTL_METADATA_PREVIEW_MS, 0, 86_400_000, 3_600_000)
};

export function clampConfigNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  return clampConfigNumber(value, min, max, fallback);
}

function parseList(value: unknown) {
  if (typeof value !== 'string') return [];
  return value
    .split(/[\n,|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
