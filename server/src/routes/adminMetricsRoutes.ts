import { Router } from 'express';
import os from 'node:os';
import type { NextFunction, Request, Response } from 'express';
import { AlertRecord } from '../models/AlertRecord.js';
import { CostMetric } from '../models/CostMetric.js';
import { DomainMetric } from '../models/DomainMetric.js';
import { FailureEvent, failureTypes } from '../models/FailureEvent.js';
import { MetricSnapshot } from '../models/MetricSnapshot.js';
import { QueueMetric } from '../models/QueueMetric.js';
import { WorkerMetric } from '../models/WorkerMetric.js';
import { getMongoOperationSnapshot } from '../utils/metrics.js';

type RangeKey = '15m' | '1h' | '6h' | '24h' | '7d' | '30d';
type QueryValue = string | string[] | undefined;

const ranges: Record<RangeKey, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
  '30d': 30 * 24 * 60 * 60_000
};
const metricCache = new Map<string, { expiresAt: number; value: Awaited<ReturnType<typeof getAdminMetricPayloadUncached>> }>();
const pendingMetrics = new Map<string, Promise<Awaited<ReturnType<typeof getAdminMetricPayloadUncached>>>>();
const DEFAULT_SOCKET_METRIC_CACHE_MS = 2_000;

export function adminMetricsRouter() {
  const router = Router();

  router.get('/overview', async (req, res, next) => {
    try {
      const range = parseRange(req);
      const [metric, queue, alerts] = await Promise.all([
        MetricSnapshot.findOne({ timestamp: { $gte: range.start, $lte: range.end } }).sort({ timestamp: -1 }).lean(),
        QueueMetric.findOne({ timestamp: { $gte: range.start, $lte: range.end } }).sort({ timestamp: -1 }).lean(),
        AlertRecord.find({ status: 'active' }).sort({ timestamp: -1 }).limit(50).lean()
      ]);
      send(res, { metric, queue, alerts }, range, [metric, queue, ...alerts].filter(Boolean).length);
    } catch (error) {
      next(error);
    }
  });

  router.get('/system', async (req, res, next) => {
    try {
      const range = parseRange(req);
      const data = await downsample(MetricSnapshot, range);
      if (data.length > 0) {
        send(res, data, range, data.length);
        return;
      }

      const latest = await MetricSnapshot.findOne().sort({ timestamp: -1 }).lean();
      const fallback = latest ? [{ ...latest, timestamp: latest.timestamp || new Date() }] : [currentProcessSnapshot()];
      send(res, fallback, range, fallback.length);
    } catch (error) {
      next(error);
    }
  });
  router.get('/queues', seriesHandler(QueueMetric));

  router.get('/workers', async (req, res, next) => {
    try {
      const range = parseRange(req);
      const [series, latest] = await Promise.all([
        workerClusterSeries(range),
        WorkerMetric.aggregate([
          { $sort: { timestamp: -1 } },
          { $group: { _id: '$worker_id', doc: { $first: '$$ROOT' } } },
          { $replaceRoot: { newRoot: '$doc' } },
          { $sort: { worker_name: 1 } }
        ])
      ]);
      send(res, { series, latest }, range, latest.length);
    } catch (error) {
      next(error);
    }
  });

  router.get('/workers/:id', async (req, res, next) => {
    try {
      const range = parseRange(req);
      const data = await WorkerMetric.find({ worker_id: req.params.id, timestamp: { $gte: range.start, $lte: range.end } }).sort({ timestamp: 1 }).lean();
      send(res, data, range, data.length);
    } catch (error) {
      next(error);
    }
  });

  router.get('/infrastructure', async (req, res, next) => {
    try {
      const range = parseRange(req);
      const data = await downsample(MetricSnapshot, range);
      const latest = await MetricSnapshot.findOne().sort({ timestamp: -1 }).lean();
      send(res, { latest, series: data }, range, data.length);
    } catch (error) {
      next(error);
    }
  });

  router.get('/mongo-operations', async (_req, res, next) => {
    try {
      const data = getMongoOperationSnapshot(25);
      send(res, data, parseRangeQuery({}), data.length);
    } catch (error) {
      next(error);
    }
  });

  router.get('/failures', async (req, res, next) => {
    try {
      const range = parseRange(req);
      const [grouped, trend] = await Promise.all([
        FailureEvent.aggregate([
          { $match: { timestamp: { $gte: range.start, $lte: range.end } } },
          { $group: { _id: '$failure_type', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ]),
        FailureEvent.aggregate([
          { $match: { timestamp: { $gte: range.start, $lte: range.end } } },
          { $group: { _id: { bucket: bucketExpression(range), type: '$failure_type' }, count: { $sum: 1 } } },
          { $sort: { '_id.bucket': 1 } }
        ])
      ]);
      send(res, { grouped, trend, types: failureTypes }, range, grouped.length);
    } catch (error) {
      next(error);
    }
  });

  router.get('/failures/timeline', async (req, res, next) => {
    try {
      const range = parseRange(req);
      const limit = Math.min(Number(req.query.limit || 200), 1000);
      const data = await FailureEvent.find({ timestamp: { $gte: range.start, $lte: range.end } }).sort({ timestamp: -1 }).limit(limit).lean();
      send(res, data, range, data.length);
    } catch (error) {
      next(error);
    }
  });

  router.get('/domains', async (req, res, next) => {
    try {
      const range = parseRange(req);
      const data = await DomainMetric.aggregate([
        { $match: { timestamp: { $gte: range.start, $lte: range.end } } },
        {
          $group: {
            _id: '$domain',
            sample_count: { $sum: { $ifNull: ['$sample_count', '$pages_crawled'] } },
            pages_crawled: { $sum: '$pages_crawled' },
            success_count: { $sum: '$success_count' },
            failed_count: { $sum: '$failed_count' },
            rate_limit_hits: { $sum: '$rate_limit_hits' },
            captcha_count: { $sum: '$captcha_count' },
            dns_failures: { $sum: '$dns_failures' },
            timeout_count: { $sum: '$timeout_count' },
            last_seen: { $max: '$timestamp' }
          }
        },
        { $match: { sample_count: { $gt: 0 } } },
        {
          $addFields: {
            success_rate_percent: { $round: [{ $multiply: [{ $divide: ['$success_count', '$sample_count'] }, 100] }, 2] },
            block_rate_percent: { $round: [{ $multiply: [{ $divide: ['$rate_limit_hits', '$sample_count'] }, 100] }, 2] },
            captcha_rate_percent: { $round: [{ $multiply: [{ $divide: ['$captcha_count', '$sample_count'] }, 100] }, 2] },
            avg_response_time_ms: null
          }
        },
        { $sort: { failed_count: -1, pages_crawled: -1 } },
        { $limit: 200 }
      ]);
      send(res, data.map((item) => ({ domain: item._id, ...item, _id: undefined })), range, data.length);
    } catch (error) {
      next(error);
    }
  });

  router.get('/domains/:domain', async (req, res, next) => {
    try {
      const range = parseRange(req);
      const domain = decodeURIComponent(req.params.domain);
      const data = await DomainMetric.find({ domain, timestamp: { $gte: range.start, $lte: range.end } }).sort({ timestamp: 1 }).lean();
      send(res, data, range, data.length);
    } catch (error) {
      next(error);
    }
  });

  router.get('/alerts', async (req, res, next) => {
    try {
      const range = parseRange(req);
      const query: Record<string, unknown> = { timestamp: { $gte: range.start, $lte: range.end } };
      if (req.query.status === 'active' || req.query.status === 'resolved') query.status = req.query.status;
      const data = await AlertRecord.find(query).sort({ timestamp: -1 }).limit(500).lean();
      send(res, data, range, data.length);
    } catch (error) {
      next(error);
    }
  });

  router.get('/capacity', async (req, res, next) => {
    try {
      const range = parseRange(req, '7d');
      const data = await MetricSnapshot.find({ timestamp: { $gte: range.start, $lte: range.end } }).sort({ timestamp: 1 }).lean();
      const projections = [
        projection('API CPU', data.map((item) => point(item.timestamp, item.api?.cpu || 0)), 90),
        projection('Worker CPU', data.map((item) => point(item.timestamp, item.workers?.avg_cpu || 0)), 90),
        projection('Redis Memory', data.map((item) => point(item.timestamp, item.redis?.maxmemory ? ((item.redis?.memory_used || 0) / item.redis.maxmemory) * 100 : 0)), 90),
        projection('MongoDB Storage', data.map((item) => point(item.timestamp, item.mongodb?.storage_used_gb || 0)), 100),
        projection('Queue Backlog', await QueueMetric.find({ timestamp: { $gte: range.start, $lte: range.end } }).sort({ timestamp: 1 }).lean().then((items) => items.map((item) => point(item.timestamp, item.total_backlog))), 100_000)
      ];
      send(res, projections, range, projections.length);
    } catch (error) {
      next(error);
    }
  });

  router.get('/costs', async (req, res, next) => {
    try {
      const range = parseRange(req, '30d');
      const data = await CostMetric.find({ date: { $gte: range.start, $lte: range.end } }).sort({ date: 1 }).lean();
      send(res, data, range, data.length);
    } catch (error) {
      next(error);
    }
  });

  router.get('/percentiles', async (req, res, next) => {
    try {
      const range = parseRange(req);
      const service = String(req.query.service || 'api');
      const fields = percentileFields(service);
      const data = await MetricSnapshot.find({ timestamp: { $gte: range.start, $lte: range.end } }).lean();
      const rows = fields.map(({ metric, path }) => {
        const values = data.map((item) => Number(getPath(item, path) || 0)).sort((a, b) => a - b);
        return { metric, p50: percentile(values, 50), p75: percentile(values, 75), p90: percentile(values, 90), p95: percentile(values, 95), p99: percentile(values, 99) };
      });
      send(res, rows, range, rows.length);
    } catch (error) {
      next(error);
    }
  });

  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, error: { code: 'ADMIN_METRICS_ERROR', message: err.message || 'Admin metrics request failed' } });
  });

  return router;
}

export async function getAdminMetricPayload(endpointWithQuery: string, inputQuery: Record<string, QueryValue> = {}) {
  const cacheKey = metricCacheKey(endpointWithQuery, inputQuery);
  const cached = metricCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pending = pendingMetrics.get(cacheKey);
  if (pending) return pending;

  const promise = getAdminMetricPayloadUncached(endpointWithQuery, inputQuery)
    .then((value) => {
      metricCache.set(cacheKey, { expiresAt: Date.now() + metricCacheTtl(endpointWithQuery), value });
      return value;
    })
    .finally(() => {
      pendingMetrics.delete(cacheKey);
    });
  pendingMetrics.set(cacheKey, promise);
  return promise;
}

async function getAdminMetricPayloadUncached(endpointWithQuery: string, inputQuery: Record<string, QueryValue> = {}) {
  const [endpoint, queryString = ''] = endpointWithQuery.split('?');
  const searchParams = new URLSearchParams(queryString);
  const query: Record<string, QueryValue> = { ...inputQuery };
  for (const [key, value] of searchParams.entries()) query[key] = value;

  if (endpoint === 'overview') {
    const range = parseRangeQuery(query);
    const [metric, queue, alerts] = await Promise.all([
      MetricSnapshot.findOne({ timestamp: { $gte: range.start, $lte: range.end } }).sort({ timestamp: -1 }).lean(),
      QueueMetric.findOne({ timestamp: { $gte: range.start, $lte: range.end } }).sort({ timestamp: -1 }).lean(),
      AlertRecord.find({ status: 'active' }).sort({ timestamp: -1 }).limit(50).lean()
    ]);
    return payload({ metric, queue, alerts }, range, [metric, queue, ...alerts].filter(Boolean).length);
  }

  if (endpoint === 'system') {
    const range = parseRangeQuery(query);
    const data = await downsample(MetricSnapshot, range);
    if (data.length > 0) return payload(data, range, data.length);
    const latest = await MetricSnapshot.findOne().sort({ timestamp: -1 }).lean();
    const fallback = latest ? [{ ...latest, timestamp: latest.timestamp || new Date() }] : [currentProcessSnapshot()];
    return payload(fallback, range, fallback.length);
  }

  if (endpoint === 'queues') {
    const range = parseRangeQuery(query);
    const data = await downsample(QueueMetric, range);
    return payload(data, range, data.length);
  }

  if (endpoint === 'workers') {
    const range = parseRangeQuery(query);
    const [series, latest] = await Promise.all([
      workerClusterSeries(range),
      WorkerMetric.aggregate([
        { $sort: { timestamp: -1 } },
        { $group: { _id: '$worker_id', doc: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { worker_name: 1 } }
      ])
    ]);
    return payload({ series, latest }, range, latest.length);
  }

  if (endpoint === 'infrastructure') {
    const range = parseRangeQuery(query);
    const data = await downsample(MetricSnapshot, range);
    const latest = await MetricSnapshot.findOne().sort({ timestamp: -1 }).lean();
    return payload({ latest, series: data }, range, data.length);
  }

  if (endpoint === 'mongo-operations') {
    const range = parseRangeQuery(query);
    const data = getMongoOperationSnapshot(25);
    return payload(data, range, data.length);
  }

  if (endpoint === 'failures') {
    const range = parseRangeQuery(query);
    const [grouped, trend] = await Promise.all([
      FailureEvent.aggregate([
        { $match: { timestamp: { $gte: range.start, $lte: range.end } } },
        { $group: { _id: '$failure_type', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      FailureEvent.aggregate([
        { $match: { timestamp: { $gte: range.start, $lte: range.end } } },
        { $group: { _id: { bucket: bucketExpression(range), type: '$failure_type' }, count: { $sum: 1 } } },
        { $sort: { '_id.bucket': 1 } }
      ])
    ]);
    return payload({ grouped, trend, types: failureTypes }, range, grouped.length);
  }

  if (endpoint === 'failures/timeline') {
    const range = parseRangeQuery(query);
    const limit = Math.min(Number(queryValue(query.limit) || 200), 1000);
    const data = await FailureEvent.find({ timestamp: { $gte: range.start, $lte: range.end } }).sort({ timestamp: -1 }).limit(limit).lean();
    return payload(data, range, data.length);
  }

  if (endpoint === 'domains') {
    const range = parseRangeQuery(query);
    const data = await domainMetrics(range);
    return payload(data, range, data.length);
  }

  if (endpoint === 'capacity') {
    const range = parseRangeQuery(query, '7d');
    const data = await MetricSnapshot.find({ timestamp: { $gte: range.start, $lte: range.end } }).sort({ timestamp: 1 }).lean();
    const projections = [
      projection('API CPU', data.map((item) => point(item.timestamp, item.api?.cpu || 0)), 90),
      projection('Worker CPU', data.map((item) => point(item.timestamp, item.workers?.avg_cpu || 0)), 90),
      projection('Redis Memory', data.map((item) => point(item.timestamp, item.redis?.maxmemory ? ((item.redis?.memory_used || 0) / item.redis.maxmemory) * 100 : 0)), 90),
      projection('MongoDB Storage', data.map((item) => point(item.timestamp, item.mongodb?.storage_used_gb || 0)), 100),
      projection('Queue Backlog', await QueueMetric.find({ timestamp: { $gte: range.start, $lte: range.end } }).sort({ timestamp: 1 }).lean().then((items) => items.map((item) => point(item.timestamp, item.total_backlog))), 100_000)
    ];
    return payload(projections, range, projections.length);
  }

  if (endpoint === 'costs') {
    const range = parseRangeQuery(query, '30d');
    const data = await CostMetric.find({ date: { $gte: range.start, $lte: range.end } }).sort({ date: 1 }).lean();
    return payload(data, range, data.length);
  }

  if (endpoint === 'percentiles') {
    const range = parseRangeQuery(query);
    const service = queryValue(query.service) || 'api';
    const fields = percentileFields(service);
    const data = await MetricSnapshot.find({ timestamp: { $gte: range.start, $lte: range.end } }).lean();
    const rows = fields.map(({ metric, path }) => {
      const values = data.map((item) => Number(getPath(item, path) || 0)).sort((a, b) => a - b);
      return { metric, p50: percentile(values, 50), p75: percentile(values, 75), p90: percentile(values, 90), p95: percentile(values, 95), p99: percentile(values, 99) };
    });
    return payload(rows, range, rows.length);
  }

  throw new Error(`Unknown admin metrics endpoint: ${endpoint}`);
}

function metricCacheKey(endpointWithQuery: string, query: Record<string, QueryValue>) {
  const entries = Object.entries(query)
    .map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : value || ''])
    .sort(([a], [b]) => a.localeCompare(b));
  return `${endpointWithQuery}?${entries.map(([key, value]) => `${key}=${value}`).join('&')}`;
}

function metricCacheTtl(endpointWithQuery: string) {
  if (/capacity|costs|percentiles|domains/.test(endpointWithQuery)) return 5_000;
  return DEFAULT_SOCKET_METRIC_CACHE_MS;
}

function seriesHandler(model: typeof MetricSnapshot | typeof QueueMetric) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const range = parseRange(req);
      const data = await downsample(model, range);
      send(res, data, range, data.length);
    } catch (error) {
      next(error);
    }
  };
}

async function workerClusterSeries(range: ReturnType<typeof parseRange>) {
  return WorkerMetric.aggregate([
    { $match: { timestamp: { $gte: range.start, $lte: range.end } } },
    {
      $group: {
        _id: bucketExpression(range),
        cpu_percent: { $avg: '$cpu_percent' },
        memory_mb: { $avg: '$memory_mb' },
        jobs_running: { $sum: '$jobs_running' },
        pages_per_sec: { $sum: '$pages_per_sec' },
        failure_rate_percent: { $avg: '$failure_rate_percent' }
      }
    },
    {
      $project: {
        _id: 0,
        timestamp: '$_id',
        cpu_percent: { $round: ['$cpu_percent', 2] },
        memory_mb: { $round: ['$memory_mb', 2] },
        jobs_running: 1,
        pages_per_sec: { $round: ['$pages_per_sec', 2] },
        failure_rate_percent: { $round: ['$failure_rate_percent', 2] }
      }
    },
    { $sort: { timestamp: 1 } },
    { $limit: 200 }
  ]);
}

function parseRange(req: Request, fallback: RangeKey = '1h') {
  return parseRangeQuery(req.query as Record<string, QueryValue>, fallback);
}

function parseRangeQuery(query: Record<string, QueryValue>, fallback: RangeKey = '1h') {
  const now = new Date();
  const fromValue = queryValue(query.from);
  const toValue = queryValue(query.to);
  const from = fromValue ? new Date(fromValue) : null;
  const to = toValue ? new Date(toValue) : now;
  if (from && Number.isFinite(from.getTime()) && Number.isFinite(to.getTime())) return { key: 'custom', start: from, end: to };
  const requestedRange = queryValue(query.range) || fallback;
  const key = (requestedRange in ranges ? requestedRange : fallback) as RangeKey;
  return { key, start: new Date(now.getTime() - ranges[key]), end: now };
}

async function downsample(model: typeof MetricSnapshot | typeof QueueMetric | typeof WorkerMetric, range: ReturnType<typeof parseRange>, fields?: Record<string, unknown>) {
  const bucketMs = bucketInterval(range);
  if (bucketMs <= 60_000) {
    return (model as any).find({ timestamp: { $gte: range.start, $lte: range.end } }).sort({ timestamp: 1 }).limit(1200).lean();
  }
  const groupFields = fields || { doc: { $first: '$$ROOT' } };
  const rows = await (model as any).aggregate([
    { $match: { timestamp: { $gte: range.start, $lte: range.end } } },
    {
      $group: {
        _id: bucketExpression(range),
        ...groupFields
      }
    },
    { $sort: { _id: 1 } },
    { $limit: 200 }
  ]);
  return fields ? rows.map((row: any) => ({ timestamp: row._id, ...row })) : rows.map((row: any) => ({ ...row.doc, timestamp: row._id }));
}

function bucketExpression(range: ReturnType<typeof parseRange>) {
  const bucketMs = bucketInterval(range);
  return { $toDate: { $multiply: [{ $floor: { $divide: [{ $toLong: '$timestamp' }, bucketMs] } }, bucketMs] } };
}

function bucketInterval(range: ReturnType<typeof parseRange>) {
  const duration = range.end.getTime() - range.start.getTime();
  if (duration <= 60 * 60_000) return 10_000;
  if (duration <= 6 * 60 * 60_000) return 5 * 60_000;
  if (duration <= 7 * 24 * 60 * 60_000) return 60 * 60_000;
  return 6 * 60 * 60_000;
}

function send(res: Response, data: unknown, range: ReturnType<typeof parseRange>, count: number) {
  res.json({ success: true, ...payload(data, range, count) });
}

function payload(data: unknown, range: ReturnType<typeof parseRange>, count: number) {
  return { data, meta: { range: range.key, from: range.start.toISOString(), to: range.end.toISOString(), count } };
}

function currentProcessSnapshot() {
  const totalMemory = os.totalmem();
  const memory = totalMemory ? (process.memoryUsage().rss / totalMemory) * 100 : 0;
  return {
    timestamp: new Date(),
    api: {
      cpu: 0,
      memory: round(memory),
      latency_p95: 0,
      requests_per_sec: 0
    },
    workers: {
      avg_cpu: 0,
      avg_memory: round(process.memoryUsage().rss / 1024 / 1024)
    },
    mongodb: {
      latency_p95: 0
    }
  };
}

async function domainMetrics(range: ReturnType<typeof parseRange>) {
  const data = await DomainMetric.aggregate([
    { $match: { timestamp: { $gte: range.start, $lte: range.end } } },
    {
      $group: {
        _id: '$domain',
        sample_count: { $sum: { $ifNull: ['$sample_count', '$pages_crawled'] } },
        pages_crawled: { $sum: '$pages_crawled' },
        success_count: { $sum: '$success_count' },
        failed_count: { $sum: '$failed_count' },
        rate_limit_hits: { $sum: '$rate_limit_hits' },
        captcha_count: { $sum: '$captcha_count' },
        dns_failures: { $sum: '$dns_failures' },
        timeout_count: { $sum: '$timeout_count' },
        last_seen: { $max: '$timestamp' }
      }
    },
    { $match: { sample_count: { $gt: 0 } } },
    {
      $addFields: {
        success_rate_percent: { $round: [{ $multiply: [{ $divide: ['$success_count', '$sample_count'] }, 100] }, 2] },
        block_rate_percent: { $round: [{ $multiply: [{ $divide: ['$rate_limit_hits', '$sample_count'] }, 100] }, 2] },
        captcha_rate_percent: { $round: [{ $multiply: [{ $divide: ['$captcha_count', '$sample_count'] }, 100] }, 2] },
        avg_response_time_ms: null
      }
    },
    { $sort: { failed_count: -1, pages_crawled: -1 } },
    { $limit: 200 }
  ]);
  return data.map((item) => ({ domain: item._id, ...item, _id: undefined }));
}

function point(timestamp: Date, value: number) {
  return { x: timestamp.getTime() / 86_400_000, value: Number(value || 0), timestamp };
}

function projection(metric: string, points: Array<{ x: number; value: number; timestamp: Date }>, capacity: number) {
  if (points.length < 2) return { metric, current_value: points.at(-1)?.value || 0, growth_rate_per_day: 0, projected_saturation_date: null, days_remaining: null, confidence: 0 };
  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.value, 0) / n;
  const slope = points.reduce((sum, p) => sum + (p.x - meanX) * (p.value - meanY), 0) / Math.max(1, points.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0));
  const current = points.at(-1)?.value || 0;
  const daysRemaining = slope > 0 ? Math.ceil((capacity * 0.9 - current) / slope) : null;
  const projected = daysRemaining && daysRemaining > 0 && daysRemaining <= 90 ? new Date(Date.now() + daysRemaining * 86_400_000).toISOString() : null;
  return { metric, current_value: round(current), growth_rate_per_day: round(slope), projected_saturation_date: projected, days_remaining: daysRemaining && daysRemaining > 0 ? daysRemaining : null, confidence: Math.min(0.95, Math.max(0.25, n / 200)) };
}

function percentile(values: number[], pct: number) {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.ceil((pct / 100) * values.length) - 1);
  return round(values[index] || 0);
}

function percentileFields(service: string) {
  if (service === 'mongodb') return [{ metric: 'Latency', path: 'mongodb.latency_p95' }, { metric: 'Queries/sec', path: 'mongodb.queries_per_sec' }];
  if (service === 'redis') return [{ metric: 'Latency', path: 'redis.latency_ms' }, { metric: 'Commands/sec', path: 'redis.commands_per_sec' }];
  if (service === 'workers') return [{ metric: 'CPU', path: 'workers.avg_cpu' }, { metric: 'Memory', path: 'workers.avg_memory' }, { metric: 'Pages/sec', path: 'workers.total_pages_per_sec' }];
  return [{ metric: 'Latency P50', path: 'api.latency_p50' }, { metric: 'Latency P95', path: 'api.latency_p95' }, { metric: 'Requests/sec', path: 'api.requests_per_sec' }];
}

function getPath(value: unknown, path: string) {
  return path.split('.').reduce<unknown>((current, key) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined), value);
}

function queryValue(value: QueryValue) {
  return Array.isArray(value) ? value[0] : value;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
