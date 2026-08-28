import crypto from 'node:crypto';
import { AlertRecord } from '../models/AlertRecord.js';
import { DomainMetric } from '../models/DomainMetric.js';
import { FailureEvent } from '../models/FailureEvent.js';
import { MetricSnapshot } from '../models/MetricSnapshot.js';
import { QueueMetric } from '../models/QueueMetric.js';
import { alertThresholds } from '../config/alertThresholds.js';
import { emitAdminAlert } from './socketServer.js';

interface Evidence {
  metric: string;
  value: number;
  threshold: number;
  unit?: string;
}

interface CandidateAlert {
  key: string;
  component: 'api' | 'workers' | 'redis' | 'mongodb' | 'proxy_pool' | 'queue' | 'domain';
  severity: 'warning' | 'critical';
  title: string;
  description: string;
  suggestion: string;
  evidence: Evidence[];
}

const active = new Map<string, string>();
const suppressedUntil = new Map<string, number>();

export async function evaluateAlerts() {
  const [metric, queue, domain, staleApiInstances] = await Promise.all([
    MetricSnapshot.findOne().sort({ timestamp: -1 }).lean(),
    QueueMetric.findOne().sort({ timestamp: -1 }).lean(),
    DomainMetric.findOne({ sample_count: { $gt: 0 }, block_rate_percent: { $ne: null } })
      .sort({ block_rate_percent: -1, timestamp: -1 })
      .lean(),
    findStaleApiInstances()
  ]);

  if (!metric) return [];

  const candidates = await buildCandidates(metric as MetricDoc, queue as QueueDoc | null, domain as DomainDoc | null, staleApiInstances);
  const seen = new Set(candidates.map((candidate) => candidate.key));

  for (const candidate of candidates) await fire(candidate);

  for (const key of [...active.keys()]) {
    if (!seen.has(key)) await resolve(key);
  }

  await resolveStaleActiveAlerts(seen);
  return candidates;
}

async function buildCandidates(
  metric: MetricDoc,
  queue: QueueDoc | null,
  domain: DomainDoc | null,
  staleApiInstances: Array<{ instance_id?: string; hostname?: string; ageSeconds: number }>
): Promise<CandidateAlert[]> {
  const candidates: CandidateAlert[] = [];

  for (const instance of staleApiInstances) {
    const name = instance.instance_id || instance.hostname || 'unknown';
    candidates.push({
      key: `api:instance_stale:${name}`,
      component: 'api',
      severity: instance.ageSeconds >= 90 ? 'critical' : 'warning',
      title: `API instance stale: ${name}`,
      description: 'An API container stopped sending health metrics while another instance is still serving the dashboard.',
      suggestion: 'Check Docker health and logs for the stale API container, then restart or replace it.',
      evidence: [
        {
          metric: 'api_metric_age_seconds',
          value: round(instance.ageSeconds),
          threshold: instance.ageSeconds >= 90 ? 90 : 30,
          unit: 's'
        }
      ]
    });
  }

  pushThreshold(candidates, {
    key: 'workers:cpu_average',
    component: 'workers',
    title: 'Worker CPU saturation',
    description: 'Average worker CPU above configured threshold.',
    suggestion: metric.workers.avg_cpu >= 90 && (queue?.backlog_growth_rate_per_min || 0) > 0
      ? 'Workers saturated. Consider scaling worker cluster horizontally.'
      : 'Inspect worker concurrency slow crawl targets.',
    value: metric.workers.avg_cpu,
    thresholds: alertThresholds.workerCpuAverage,
    metric: 'worker_cpu_avg',
    unit: '%'
  });

  pushThreshold(candidates, {
    key: 'queue:backlog_growth',
    component: 'queue',
    title: 'Queue backlog growing',
    description: 'Backlog growth indicates crawler throughput below incoming workload.',
    suggestion: 'Increase crawl worker capacity reduce enqueue rate until backlog drains.',
    value: queue?.backlog_growth_rate_per_min || 0,
    thresholds: alertThresholds.queueBacklogGrowthPerMin,
    metric: 'backlog_growth_rate_per_min',
    unit: 'jobs/min'
  });

  const redisPercent = metric.redis.maxmemory > 0 ? (metric.redis.memory_used / metric.redis.maxmemory) * 100 : 0;
  pushThreshold(candidates, {
    key: 'redis:memory',
    component: 'redis',
    title: 'Redis memory pressure',
    description: 'Redis memory usage approaching configured maxmemory limit.',
    suggestion: 'Review queue retention Redis maxmemory settings.',
    value: redisPercent,
    thresholds: alertThresholds.redisMemoryPercent,
    metric: 'redis_memory_percent',
    unit: '%'
  });

  pushThreshold(candidates, {
    key: 'mongodb:latency_p95',
    component: 'mongodb',
    title: 'MongoDB latency spike',
    description: 'MongoDB P95 latency above operational threshold.',
    suggestion: 'Check missing indexes lock contention recent queries.',
    value: metric.mongodb.latency_p95,
    thresholds: alertThresholds.mongoLatencyP95Ms,
    metric: 'mongodb_latency_p95',
    unit: 'ms'
  });

  pushInverseThreshold(candidates, {
    key: 'proxy_pool:success_rate',
    component: 'proxy_pool',
    title: 'Proxy success rate dropping',
    description: 'Proxy success rate below configured threshold.',
    suggestion: 'Proxy provider degradation target site block pattern change.',
    value: metric.proxy_pool.success_rate,
    thresholds: alertThresholds.proxySuccessRate,
    metric: 'proxy_success_rate',
    unit: '%'
  });

  if (domain) {
    pushThreshold(candidates, {
      key: `domain:block_rate:${domain.domain}`,
      component: 'domain',
      title: `Domain block rate high: ${domain.domain}`,
      description: 'Target domain returning elevated block/captcha indicators.',
      suggestion: 'Reduce crawl rate domain rotate request identity.',
      value: domain.block_rate_percent,
      thresholds: alertThresholds.domainBlockRate,
      metric: 'domain_block_rate',
      unit: '%'
    });
  }

  const failureIncrease = await failureRateIncreasePercent();
  pushThreshold(candidates, {
    key: 'failures:increase',
    component: 'queue',
    title: 'Failure rate increasing',
    description: 'Recent failure volume elevated compared 15 minute average.',
    suggestion: 'Open failures page inspect dominant failure type affected domains.',
    value: failureIncrease,
    thresholds: alertThresholds.failureRateIncreasePercent,
    metric: 'failure_rate_increase',
    unit: '%'
  });

  return candidates;
}

function pushThreshold(target: CandidateAlert[], input: ThresholdInput) {
  const severity = input.value >= input.thresholds.critical ? 'critical' : input.value >= input.thresholds.warning ? 'warning' : null;
  if (!severity) return;
  target.push(toCandidate(input, severity, severity === 'critical' ? input.thresholds.critical : input.thresholds.warning));
}

function pushInverseThreshold(target: CandidateAlert[], input: ThresholdInput) {
  const severity = input.value <= input.thresholds.critical ? 'critical' : input.value <= input.thresholds.warning ? 'warning' : null;
  if (!severity) return;
  target.push(toCandidate(input, severity, severity === 'critical' ? input.thresholds.critical : input.thresholds.warning));
}

function toCandidate(input: ThresholdInput, severity: 'warning' | 'critical', threshold: number): CandidateAlert {
  return {
    key: input.key,
    component: input.component,
    title: input.title,
    description: input.description,
    suggestion: input.suggestion,
    severity,
    evidence: [{ metric: input.metric, value: round(input.value), threshold, unit: input.unit }]
  };
}

async function fire(candidate: CandidateAlert) {
  const now = Date.now();
  if ((suppressedUntil.get(candidate.key) || 0) > now) return;
  if (active.has(candidate.key)) return;

  const existing = await AlertRecord.findOne({ alert_key: candidate.key, status: 'active' }).sort({ timestamp: -1 });
  if (existing) {
    active.set(candidate.key, existing.alert_id);
    return;
  }

  const alert = await AlertRecord.create({
    alert_id: crypto.randomUUID(),
    alert_key: candidate.key,
    severity: candidate.severity,
    component: candidate.component,
    title: candidate.title,
    description: candidate.description,
    suggestion: candidate.suggestion,
    evidence: candidate.evidence,
    status: 'active'
  });

  active.set(candidate.key, alert.alert_id);
  emitAdminAlert('alerts:new', alert.toObject());
}

async function resolve(key: string) {
  const alertId = active.get(key);
  const alert = alertId
    ? await AlertRecord.findOne({ alert_id: alertId, status: 'active' })
    : await AlertRecord.findOne({ alert_key: key, status: 'active' }).sort({ timestamp: -1 });

  active.delete(key);
  if (!alert) return;

  const { resolvedAt, duration } = await resolveAlert(alert);
  if (duration * 1000 <= alertThresholds.flapWindowMs) suppressedUntil.set(key, Date.now() + alertThresholds.suppressionMs);
  emitAdminAlert('alerts:resolve', { alert_id: alert.alert_id, resolved_at: resolvedAt, duration_seconds: duration });
}

async function resolveStaleActiveAlerts(seen: Set<string>) {
  const alerts = await AlertRecord.find({ status: 'active' })
    .sort({ timestamp: -1 })
    .select('alert_id alert_key timestamp status resolved_at duration_seconds');

  const keptActiveKeys = new Set<string>();
  for (const alert of alerts) {
    if (seen.has(alert.alert_key)) {
      if (!keptActiveKeys.has(alert.alert_key)) {
        active.set(alert.alert_key, alert.alert_id);
        keptActiveKeys.add(alert.alert_key);
        continue;
      }
      const { resolvedAt, duration } = await resolveAlert(alert);
      emitAdminAlert('alerts:resolve', { alert_id: alert.alert_id, resolved_at: resolvedAt, duration_seconds: duration });
      continue;
    }

    active.delete(alert.alert_key);
    const { resolvedAt, duration } = await resolveAlert(alert);
    if (duration * 1000 <= alertThresholds.flapWindowMs) suppressedUntil.set(alert.alert_key, Date.now() + alertThresholds.suppressionMs);
    emitAdminAlert('alerts:resolve', { alert_id: alert.alert_id, resolved_at: resolvedAt, duration_seconds: duration });
  }
}

async function resolveAlert(alert: any) {
  const resolvedAt = new Date();
  const duration = Math.max(0, Math.round((resolvedAt.getTime() - alert.timestamp.getTime()) / 1000));
  alert.status = 'resolved';
  alert.resolved_at = resolvedAt;
  alert.duration_seconds = duration;
  await alert.save();
  return { resolvedAt, duration };
}

async function failureRateIncreasePercent() {
  const now = Date.now();
  const recent = await FailureEvent.countDocuments({ timestamp: { $gte: new Date(now - 60_000) } });
  const baseline = await FailureEvent.countDocuments({ timestamp: { $gte: new Date(now - 16 * 60_000), $lt: new Date(now - 60_000) } });
  const perMinuteBaseline = baseline / 15;
  if (perMinuteBaseline <= 0) return recent > 0 ? 100 : 0;
  return ((recent - perMinuteBaseline) / perMinuteBaseline) * 100;
}

async function findStaleApiInstances() {
  const staleBefore = new Date(Date.now() - 30_000);
  const rows = await MetricSnapshot.aggregate([
    { $sort: { timestamp: -1 } },
    { $group: { _id: { $ifNull: ['$instance_id', 'unknown'] }, doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } }
  ]);

  return rows
    .map((row) => ({
      instance_id: String(row.instance_id || row._id || ''),
      hostname: String(row.hostname || ''),
      timestamp: row.timestamp ? new Date(row.timestamp) : null
    }))
    .filter((row) => row.timestamp && row.timestamp < staleBefore)
    .map((row) => ({
      instance_id: row.instance_id,
      hostname: row.hostname,
      ageSeconds: row.timestamp ? (Date.now() - row.timestamp.getTime()) / 1000 : 0
    }));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

interface ThresholdInput {
  key: string;
  component: CandidateAlert['component'];
  title: string;
  description: string;
  suggestion: string;
  value: number;
  thresholds: { warning: number; critical: number };
  metric: string;
  unit: string;
}

type MetricDoc = {
  workers: { avg_cpu: number };
  redis: { memory_used: number; maxmemory: number };
  mongodb: { latency_p95: number };
  proxy_pool: { success_rate: number };
};

type QueueDoc = { backlog_growth_rate_per_min: number };
type DomainDoc = { domain: string; block_rate_percent: number };
