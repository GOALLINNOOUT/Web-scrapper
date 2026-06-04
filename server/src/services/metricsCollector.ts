import mongoose from 'mongoose';
import si from 'systeminformation';
import type { Queue } from 'bullmq';
import { CrawlJob } from '../models/CrawlJob.js';
import { DomainProfile } from '../models/DomainProfile.js';
import { Page } from '../models/Page.js';
import { MetricSnapshot } from '../models/MetricSnapshot.js';
import { QueueMetric } from '../models/QueueMetric.js';
import { WorkerMetric } from '../models/WorkerMetric.js';
import { DomainMetric } from '../models/DomainMetric.js';
import { FailureEvent } from '../models/FailureEvent.js';
import { config } from '../config/index.js';
import { redisConnection } from '../queue/connection.js';
import { queueNames, type QueueBundle } from '../queue/queues.js';
import { domainFromUrl } from '../utils/url.js';
import { logger } from '../utils/logger.js';
import { getApiLatencySnapshot } from '../utils/metrics.js';
import { broadcastSystemHealth, emitAdminRoom } from './socketServer.js';
import { evaluateAlerts } from './alertEngine.js';

let started = false;
let lastQueueBacklog = 0;
let lastQueueAt = Date.now();
let lastPagesCrawled = 0;
let lastCompletedJobs = 0;
let lastFailureJobs = 0;
const mongoLatencySamples: Array<{ at: number; ms: number }> = [];
const MONGO_LATENCY_WINDOW_MS = 60_000;
let lastProcessCpuUsage = process.cpuUsage();
let lastProcessCpuAt = process.hrtime.bigint();
let cachedProcessCpuPercent = 0;
let mongoAdminCache: {
  refreshedAt: number;
  stats: Awaited<ReturnType<NonNullable<typeof mongoose.connection.db>['stats']>> | null;
  serverStatus: any;
} = { refreshedAt: 0, stats: null, serverStatus: null };
let lastMongoQueryCount = 0;
let lastMongoQueryAt = Date.now();
let proxyStatsCache: Awaited<ReturnType<typeof getProxyStatsUncached>> | null = null;
let proxyStatsCacheAt = 0;

export function startAdminMetricsCollector(queues?: QueueBundle) {
  if (started) return;
  started = true;

  const collectSystem = () => void collectSystemMetrics(queues).catch((error) => logCollectorError(error, 'system metrics collection failed'));
  const collectWorkers = () => void collectWorkerMetrics(queues).catch((error) => logCollectorError(error, 'worker metrics collection failed'));
  const collectDomains = () => void collectDomainMetrics().catch((error) => logCollectorError(error, 'domain metrics collection failed'));
  const evaluate = () => void evaluateAlerts().catch((error) => logCollectorError(error, 'alert evaluation failed'));
  const health = () => void emitHealth().catch((error) => logCollectorError(error, 'system health emit failed'));

  collectSystem();
  collectWorkers();
  collectDomains();
  evaluate();
  health();

  const timers = [
    setInterval(collectSystem, 10_000),
    setInterval(collectWorkers, 10_000),
    setInterval(collectDomains, 60_000),
    setInterval(evaluate, 15_000),
    setInterval(health, 5_000)
  ];
  for (const timer of timers) timer.unref();
}

export async function recordFailureEvent(input: {
  jobId?: string;
  domain?: string;
  workerId?: string;
  error?: Error;
  retryCount?: number;
  isTerminal?: boolean;
  url?: string;
  httpStatus?: number;
  proxy?: string;
  userAgent?: string;
}) {
  const domain = input.domain || safeDomain(input.url);
  const failureType = classifyFailure(input.error?.message || '', input.httpStatus);
  const event = await FailureEvent.create({
    job_id: input.jobId || '',
    domain,
    worker_id: input.workerId || '',
    failure_type: failureType,
    http_status: input.httpStatus || statusFromFailure(failureType),
    error_message: input.error?.message || '',
    stack_trace: input.error?.stack || '',
    retry_count: input.retryCount || 0,
    is_terminal: Boolean(input.isTerminal),
    proxy_used: input.proxy || '',
    user_agent_used: input.userAgent || '',
    url_attempted: input.url || ''
  });
  emitAdminRoom('live:failures', 'failures:live', await FailureEvent.find().sort({ timestamp: -1 }).limit(50).lean(), 'failures:live');
  return event;
}

async function collectSystemMetrics(queues?: QueueBundle) {
  const timestamp = new Date();
  const [mem, fs, network, queueMetric, redisStats, crawlStats, proxyStats] = await Promise.all([
    si.mem().catch(() => null),
    si.fsStats().catch(() => null),
    si.networkStats().catch(() => []),
    buildQueueMetric(queues),
    getRedisStats(queues),
    getCrawlStats(),
    getProxyStats()
  ]);
  const mongoStats = await getMongoStats();

  const processMemoryPercent = mem?.total ? (process.memoryUsage().rss / mem.total) * 100 : 0;
  const net = Array.isArray(network) ? network[0] : network;
  const cpu = sampleProcessCpuPercent();
  const apiLatency = getApiLatencySnapshot(10);
  const pagesPerSec = rate(crawlStats.pagesCrawled, lastPagesCrawled, 10);
  const jobsPerSec = rate(crawlStats.completedJobs, lastCompletedJobs, 10);
  const failedPerSec = rate(crawlStats.failedJobs, lastFailureJobs, 10);
  lastPagesCrawled = crawlStats.pagesCrawled;
  lastCompletedJobs = crawlStats.completedJobs;
  lastFailureJobs = crawlStats.failedJobs;

  const metric = await MetricSnapshot.create({
    timestamp,
    interval: 10,
    api: {
      cpu,
      memory: round(processMemoryPercent),
      network_in: Number(net?.rx_sec || 0),
      network_out: Number(net?.tx_sec || 0),
      disk_read: Number(fs?.rx_sec || 0),
      disk_write: Number(fs?.wx_sec || 0),
      latency_p50: apiLatency.latency_p50,
      latency_p95: apiLatency.latency_p95,
      latency_p99: apiLatency.latency_p99,
      uptime_seconds: Math.round(process.uptime()),
      requests_per_sec: apiLatency.requests_per_sec
    },
    workers: {
      total: workerDefinitions().length,
      active: queueMetric.crawl_queue.active,
      idle: Math.max(0, workerDefinitions().length - queueMetric.crawl_queue.active),
      crashed: 0,
      avg_cpu: cpu,
      avg_memory: round(process.memoryUsage().rss / 1024 / 1024),
      total_jobs_per_sec: jobsPerSec,
      total_pages_per_sec: pagesPerSec,
      total_failure_rate: round((failedPerSec / Math.max(1, jobsPerSec + failedPerSec)) * 100)
    },
    redis: redisStats,
    mongodb: mongoStats,
    proxy_pool: proxyStats,
    system_totals: {
      requests_per_sec: 0,
      pages_per_sec: pagesPerSec,
      jobs_per_sec: jobsPerSec,
      domains_per_sec: 0,
      active_crawls: crawlStats.activeCrawls,
      queued_crawls: crawlStats.queuedCrawls,
      running_crawls: crawlStats.runningCrawls,
      completed_crawls: crawlStats.completedCrawls,
      failed_crawls: crawlStats.failedCrawls
    }
  });

  const queueDoc = await QueueMetric.create({ timestamp, ...queueMetric });
  emitAdminRoom('live:overview', 'metrics:live', { metric: metric.toObject(), queue: queueDoc.toObject() }, 'metrics:live');
}

async function collectWorkerMetrics(queues?: QueueBundle) {
  const timestamp = new Date();
  const defs = workerDefinitions();
  const docs = [];
  const cpu = sampleProcessCpuPercent();
  const memoryMb = round(process.memoryUsage().rss / 1024 / 1024);

  for (const def of defs) {
    const queue = queueForName(queues, def.queueName);
    const counts = queue ? await queue.getJobCounts('active', 'completed', 'failed').catch(() => ({ active: 0, completed: 0, failed: 0 })) : { active: 0, completed: 0, failed: 0 };
    const completed = Number(counts.completed || 0);
    const failed = Number(counts.failed || 0);
    docs.push(await WorkerMetric.create({
      timestamp,
      worker_id: def.id,
      worker_name: def.name,
      status: Number(counts.active || 0) > 0 ? 'active' : 'idle',
      cpu_percent: cpu,
      memory_mb: memoryMb,
      jobs_running: Number(counts.active || 0),
      jobs_completed_total: completed,
      jobs_failed_total: failed,
      pages_per_sec: def.id === 'crawl-pages' ? await recentPagesPerSecond() : 0,
      restart_count: 0,
      last_restart_at: null,
      uptime_seconds: Math.round(process.uptime()),
      failure_rate_percent: round((failed / Math.max(1, completed + failed)) * 100)
    }));
  }
  emitAdminRoom('live:infrastructure', 'workers:live', docs.map((doc) => doc.toObject()), 'workers:live');
}

async function collectDomainMetrics() {
  const timestamp = new Date();
  const domains = await DomainProfile.find().sort({ lastCrawledAt: -1 }).limit(50).lean();
  const docs = [];
  for (const profile of domains) {
    const since = new Date(Date.now() - 60_000);
    const [success, failed, failures] = await Promise.all([
      Page.countDocuments({ domain: profile.domain, status: 'crawled', crawledAt: { $gte: since } }),
      Page.countDocuments({ domain: profile.domain, status: 'failed', crawledAt: { $gte: since } }),
      FailureEvent.find({ domain: profile.domain, timestamp: { $gte: since } }).lean()
    ]);
    const total = success + failed;
    const rateLimited = failures.filter((failure) => failure.failure_type === 'rate_limited_429' || failure.failure_type === 'forbidden_403').length;
    const captcha = failures.filter((failure) => failure.failure_type === 'captcha').length;
    const timeouts = failures.filter((failure) => failure.failure_type === 'timeout').length;
    const dns = failures.filter((failure) => failure.failure_type === 'dns_failure').length;
    if (total === 0 && failures.length === 0) continue;

    docs.push(await DomainMetric.create({
      timestamp,
      domain: profile.domain,
      sample_count: total,
      pages_crawled: total,
      success_count: success,
      failed_count: failed,
      success_rate_percent: total ? round((success / total) * 100) : null,
      block_rate_percent: total ? round((rateLimited / total) * 100) : null,
      captcha_rate_percent: total ? round((captcha / total) * 100) : null,
      avg_response_time_ms: null,
      response_time_p50: null,
      response_time_p95: null,
      response_time_p99: null,
      rate_limit_hits: rateLimited,
      captcha_count: captcha,
      dns_failures: dns,
      timeout_count: timeouts
    }));
  }
  emitAdminRoom('live:crawling', 'domains:live', docs.map((doc) => doc.toObject()), 'domains:live');
}

async function buildQueueMetric(queues?: QueueBundle) {
  const crawlQueueNames = [queueNames.crawlJobs, queueNames.crawlPagesHigh, queueNames.crawlPages, queueNames.crawlPagesLow];
  const pageQueueNames = [queueNames.crawlPagesHigh, queueNames.crawlPages, queueNames.crawlPagesLow];
  const retryQueueNames = [queueNames.monitoringChecks, queueNames.changeDetection, queueNames.domainEnrichment, queueNames.webhooks, queueNames.alerts];
  const [crawl, pages, retry, runningCrawls, queuedCrawls, recentCrawlFailures, recentRetryFailures] = await Promise.all([
    aggregateQueueCounts(queues, crawlQueueNames),
    aggregateQueueCounts(queues, pageQueueNames),
    aggregateQueueCounts(queues, retryQueueNames),
    CrawlJob.countDocuments({ status: 'running' }),
    CrawlJob.countDocuments({ status: 'queued' }),
    recentFailureEvents(['crawl-jobs', 'crawl-pages'], 5 * 60_000),
    recentFailureEvents(['monitoring-checks', 'domain-enrichment'], 5 * 60_000)
  ]);
  const retainedFailedCount = crawl.failed + retry.failed;
  crawl.failed = recentCrawlFailures;
  retry.failed = recentRetryFailures;
  const deadLetterCount = retainedFailedCount + await CrawlJob.countDocuments({ deadLetterReason: { $ne: null } });
  const totalBacklog = crawl.waiting + crawl.active + crawl.delayed + retry.waiting + retry.active + retry.delayed;
  const now = Date.now();
  const growth = ((totalBacklog - lastQueueBacklog) / Math.max(1, now - lastQueueAt)) * 60_000;
  lastQueueBacklog = totalBacklog;
  lastQueueAt = now;
  const throughput = Math.max(0.1, await recentPagesPerSecond());
  return {
    crawl_queue: crawl,
    retry_queue: retry,
    dead_letter_queue: { count: deadLetterCount },
    crawl_breakdown: {
      active_page_jobs: pages.active,
      running_crawls: runningCrawls,
      queued_crawls: queuedCrawls,
      worker_concurrency: config.crawlPageWorkerConcurrency
    },
    total_backlog: totalBacklog,
    backlog_growth_rate_per_min: round(growth),
    estimated_drain_time_minutes: round(totalBacklog / throughput / 60)
  };
}

async function recentFailureEvents(workerIds: string[], windowMs: number) {
  return FailureEvent.countDocuments({
    worker_id: { $in: workerIds },
    timestamp: { $gte: new Date(Date.now() - windowMs) }
  }).catch(() => 0);
}

async function aggregateQueueCounts(queues: QueueBundle | undefined, names: string[]) {
  const total = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 };
  for (const name of names) {
    const queue = queueForName(queues, name);
    if (!queue) continue;
    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused').catch(() => total);
    for (const key of Object.keys(total) as Array<keyof typeof total>) total[key] += Number(counts[key] || 0);
  }
  return total;
}

async function getRedisStats(queues?: QueueBundle) {
  const fallback = { memory_used: 0, memory_peak: 0, maxmemory: 0, commands_per_sec: 0, latency_ms: 0, connected_clients: 0, queue_throughput: 0 };
  if (!config.redisUrl) return fallback;
  try {
    const redis = redisConnection();
    const [info, latency] = await Promise.all([redis.info(), redis.ping().then(() => 1).catch(() => 0)]);
    const parsed = parseRedisInfo(info);
    const queueCounts = await aggregateQueueCounts(queues, Object.values(queueNames));
    return {
      memory_used: Number(parsed.used_memory || 0),
      memory_peak: Number(parsed.used_memory_peak || 0),
      maxmemory: Number(parsed.maxmemory || 0),
      commands_per_sec: Number(parsed.instantaneous_ops_per_sec || 0),
      latency_ms: latency,
      connected_clients: Number(parsed.connected_clients || 0),
      queue_throughput: Number(queueCounts.completed || 0)
    };
  } catch {
    return fallback;
  }
}

async function getMongoStats() {
  const db = mongoose.connection.db;
  if (!db) {
    return {
      queries_per_sec: 0,
      latency_p50: 0,
      latency_p95: 0,
      latency_p99: 0,
      connections_active: 0,
      slow_queries_count: 0,
      storage_used_mb: 0,
      storage_total_mb: config.mongodbStorageLimitMb,
      storage_free_mb: config.mongodbStorageLimitMb,
      storage_used_gb: 0,
      storage_total_gb: round(config.mongodbStorageLimitMb / 1024),
      storage_free_gb: round(config.mongodbStorageLimitMb / 1024),
      storage_used_percent: 0
    };
  }

  const latency = await measureMongoPingMs(db);
  recordMongoLatencySample(latency);

  const { stats, serverStatus } = await getMongoAdminStats(db);
  const dataBytes = Number(stats?.dataSize || 0);
  const usedMb = dataBytes / 1024 / 1024;
  const totalMb = config.mongodbStorageLimitMb;
  const freeMb = Math.max(0, totalMb - usedMb);
  return {
    queries_per_sec: mongoQueryRate(Number(serverStatus?.opcounters?.query || 0)),
    latency_p50: mongoLatencyPercentile(50),
    latency_p95: mongoLatencyPercentile(95),
    latency_p99: mongoLatencyPercentile(99),
    connections_active: Number(serverStatus?.connections?.current || 0),
    slow_queries_count: Number(serverStatus?.metrics?.operation?.scanAndOrder || 0),
    storage_used_mb: round(usedMb),
    storage_total_mb: round(totalMb),
    storage_free_mb: round(freeMb),
    storage_used_gb: round(usedMb / 1024),
    storage_total_gb: round(totalMb / 1024),
    storage_free_gb: round(freeMb / 1024),
    storage_used_percent: round(totalMb ? (usedMb / totalMb) * 100 : 0)
  };
}

async function measureMongoPingMs(db: NonNullable<typeof mongoose.connection.db>) {
  const started = process.hrtime.bigint();
  await db.command({ ping: 1 }, { timeoutMS: 2000 }).catch(() => null);
  return round(Number(process.hrtime.bigint() - started) / 1_000_000);
}

function recordMongoLatencySample(value: number) {
  const now = Date.now();
  mongoLatencySamples.push({ at: now, ms: value });
  pruneMongoLatencySamples(now);
}

function mongoLatencyPercentile(pct: number) {
  const now = Date.now();
  pruneMongoLatencySamples(now);
  return percentile(mongoLatencySamples.map((sample) => sample.ms), pct);
}

function pruneMongoLatencySamples(now: number) {
  const cutoff = now - MONGO_LATENCY_WINDOW_MS;
  while (mongoLatencySamples.length && mongoLatencySamples[0].at < cutoff) mongoLatencySamples.shift();
}

async function getMongoAdminStats(db: NonNullable<typeof mongoose.connection.db>) {
  const now = Date.now();
  if (now - mongoAdminCache.refreshedAt < 60_000) return mongoAdminCache;

  const admin = db.admin();
  const [stats, serverStatus] = await Promise.all([
    db.stats().catch(() => null),
    admin.serverStatus().catch(() => null)
  ]);
  mongoAdminCache = { refreshedAt: now, stats, serverStatus };
  return mongoAdminCache;
}

function mongoQueryRate(currentQueryCount: number) {
  const now = Date.now();
  const elapsedSeconds = Math.max(1, (now - lastMongoQueryAt) / 1000);
  const rate = currentQueryCount >= lastMongoQueryCount ? (currentQueryCount - lastMongoQueryCount) / elapsedSeconds : 0;
  lastMongoQueryCount = currentQueryCount;
  lastMongoQueryAt = now;
  return round(rate);
}

async function getCrawlStats() {
  const [jobCounts, pagesCrawled] = await Promise.all([
    CrawlJob.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    Page.countDocuments({ status: 'crawled' })
  ]);
  const byStatus = Object.fromEntries(jobCounts.map((item) => [String(item._id), Number(item.count || 0)]));
  const queuedCrawls = byStatus.queued || 0;
  const runningCrawls = byStatus.running || 0;
  const completedCrawls = byStatus.completed || 0;
  const failedCrawls = byStatus.failed || 0;
  const completedJobs = completedCrawls;
  const failedJobs = failedCrawls;
  const activeCrawls = queuedCrawls + runningCrawls;
  return { activeCrawls, queuedCrawls, runningCrawls, completedCrawls, failedCrawls, pagesCrawled, completedJobs, failedJobs };
}

async function getProxyStats() {
  const now = Date.now();
  if (proxyStatsCache && now - proxyStatsCacheAt < 60_000) return proxyStatsCache;
  proxyStatsCache = await getProxyStatsUncached();
  proxyStatsCacheAt = now;
  return proxyStatsCache;
}

async function getProxyStatsUncached() {
  const total = config.crawlerProxyUrls.length;
  const since = new Date(Date.now() - 60 * 60_000);
  const [failures, pages] = await Promise.all([
    FailureEvent.countDocuments({ failure_type: 'proxy_failure', timestamp: { $gte: since } }),
    Page.countDocuments({ crawledAt: { $gte: since } })
  ]);
  const requests = failures + pages;
  const successRate = requests ? round((pages / requests) * 100) : 100;
  return {
    total_proxies: total,
    active_proxies: total,
    requests_total: requests,
    success_rate: successRate,
    avg_response_time_ms: 0,
    provider_breakdown: total ? config.crawlerProxyUrls.map((url) => ({
      name: proxyProviderName(url),
      utilization: round(100 / total),
      success_rate: successRate
    })) : []
  };
}

async function emitHealth() {
  const [metric, queue, activeAlerts] = await Promise.all([
    MetricSnapshot.findOne().sort({ timestamp: -1 }).lean(),
    QueueMetric.findOne().sort({ timestamp: -1 }).lean(),
    FailureEvent.countDocuments({ timestamp: { $gte: new Date(Date.now() - 60_000) } })
  ]);
  const health = {
    api: statusFrom(metric?.api?.latency_p95 || 0, 500, 1000),
    workers: statusFrom(metric?.workers?.avg_cpu || 0, 85, 90),
    redis: statusFrom(metric?.redis?.maxmemory ? ((metric.redis?.memory_used || 0) / metric.redis.maxmemory) * 100 : 0, 75, 90),
    mongodb: statusFrom(metric?.mongodb?.latency_p95 || 0, 200, 500),
    proxy_pool: statusFromInverse(metric?.proxy_pool?.success_rate || 100, 85, 70),
    queue: statusFrom(queue ? queue.backlog_growth_rate_per_min : 0, 50, 200),
    failures: activeAlerts > 0 ? 'Warning' : 'Healthy'
  };
  broadcastSystemHealth(health);
}

function workerDefinitions() {
  return [
    { id: 'crawl-jobs', name: 'Crawl Job Worker', queueName: queueNames.crawlJobs },
    { id: 'crawl-pages', name: 'Crawl Page Worker', queueName: queueNames.crawlPages },
    { id: 'monitoring-checks', name: 'Monitoring Worker', queueName: queueNames.monitoringChecks },
    { id: 'domain-enrichment', name: 'Domain Enrichment Worker', queueName: queueNames.domainEnrichment }
  ];
}

function queueForName(queues: QueueBundle | undefined, name: string): Queue | undefined {
  return Object.values(queues || {}).find((queue) => 'name' in queue && queue.name === name) as Queue | undefined;
}

function parseRedisInfo(info: string) {
  return Object.fromEntries(info.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((line) => {
    const [key, value] = line.split(':');
    return [key, value];
  }));
}

async function recentPagesPerSecond() {
  const since = new Date(Date.now() - 60_000);
  const count = await Page.countDocuments({ status: 'crawled', crawledAt: { $gte: since } });
  return round(count / 60);
}

function classifyFailure(message: string, status?: number) {
  const text = message.toLowerCase();
  if (status === 429 || text.includes('429') || text.includes('rate limit')) return 'rate_limited_429';
  if (status === 403 || text.includes('403') || text.includes('forbidden')) return 'forbidden_403';
  if (text.includes('captcha')) return 'captcha';
  if (text.includes('proxy')) return 'proxy_failure';
  if (text.includes('timeout') || text.includes('timed out')) return 'timeout';
  if (text.includes('dns') || text.includes('enotfound') || text.includes('eai_again')) return 'dns_failure';
  if (text.includes('parse') || text.includes('extract')) return 'parser_error';
  if (text.includes('mongo') || text.includes('database')) return 'database_error';
  if (text.includes('network') || text.includes('socket') || text.includes('econn')) return 'network_error';
  if (text.includes('stalled') || text.includes('lock') || text.includes('allowable limit')) return 'queue_stalled';
  return 'unknown';
}

function statusFromFailure(type: string) {
  if (type === 'rate_limited_429') return 429;
  if (type === 'forbidden_403') return 403;
  return null;
}

function statusFrom(value: number, warning: number, critical: number) {
  if (value >= critical) return 'Critical';
  if (value >= warning) return 'Warning';
  return 'Healthy';
}

function statusFromInverse(value: number, warning: number, critical: number) {
  if (value <= critical) return 'Critical';
  if (value <= warning) return 'Warning';
  return 'Healthy';
}

function rate(current: number, previous: number, seconds: number) {
  return round(Math.max(0, current - previous) / seconds);
}

function sampleProcessCpuPercent() {
  const now = process.hrtime.bigint();
  const currentUsage = process.cpuUsage();
  const elapsedMicros = Number(now - lastProcessCpuAt) / 1000;
  if (elapsedMicros < 250_000) return cachedProcessCpuPercent;

  const usageDelta = process.cpuUsage(lastProcessCpuUsage);
  cachedProcessCpuPercent = round(((usageDelta.user + usageDelta.system) / elapsedMicros) * 100);
  lastProcessCpuUsage = currentUsage;
  lastProcessCpuAt = now;
  return cachedProcessCpuPercent;
}

function percentile(values: number[], pct: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return round(sorted[index] || 0);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function safeDomain(value?: string) {
  if (!value) return '';
  try {
    return domainFromUrl(value);
  } catch {
    return '';
  }
}

function proxyProviderName(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return 'configured-proxy';
  }
}

function logCollectorError(error: unknown, message: string) {
  logger.warn({ err: error instanceof Error ? error.message : String(error) }, message);
}
