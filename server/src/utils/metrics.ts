type Labels = Record<string, string | number | boolean | undefined>;

interface MetricRecord {
  type: 'counter' | 'gauge' | 'histogram';
  help: string;
  values: Map<string, number>;
}

const metrics = new Map<string, MetricRecord>();
const histogramBuckets = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];
const apiLatencySamples: Array<{ at: number; ms: number }> = [];
const mongoOperationSamples: Array<{ at: number; operation: string; collection: string; ms: number }> = [];
const API_LATENCY_WINDOW_MS = 60_000;
const MONGO_OPERATION_WINDOW_MS = 5 * 60_000;

export function incrementMetric(name: string, help: string, labels: Labels = {}, value = 1) {
  const metric = getMetric(name, 'counter', help);
  const key = labelKey(labels);
  metric.values.set(key, (metric.values.get(key) || 0) + value);
}

export function setGauge(name: string, help: string, labels: Labels = {}, value: number) {
  const metric = getMetric(name, 'gauge', help);
  metric.values.set(labelKey(labels), value);
}

export function observeHistogram(name: string, help: string, seconds: number, labels: Labels = {}) {
  const metric = getMetric(name, 'histogram', help);
  for (const bucket of histogramBuckets) {
    const key = labelKey({ ...labels, le: bucket });
    metric.values.set(key, (metric.values.get(key) || 0) + (seconds <= bucket ? 1 : 0));
  }
  const infinityKey = labelKey({ ...labels, le: '+Inf' });
  metric.values.set(infinityKey, (metric.values.get(infinityKey) || 0) + 1);
  const sumKey = labelKey({ ...labels, stat: 'sum' });
  metric.values.set(sumKey, (metric.values.get(sumKey) || 0) + seconds);
}

export function observeApiRequest(seconds: number) {
  const now = Date.now();
  apiLatencySamples.push({ at: now, ms: seconds * 1000 });
  pruneApiLatencySamples(now);
}

export function observeMongoOperation(operation: string, collection: string, seconds: number) {
  const now = Date.now();
  observeHistogram('webintel_mongo_operation_seconds', 'MongoDB operation duration in seconds', seconds, { operation, collection });
  mongoOperationSamples.push({ at: now, operation, collection, ms: seconds * 1000 });
  pruneMongoOperationSamples(now);
}

export async function timeMongoOperation<T>(operation: string, collection: string, run: () => Promise<T>): Promise<T> {
  const start = process.hrtime.bigint();
  try {
    return await run();
  } finally {
    observeMongoOperation(operation, collection, Number(process.hrtime.bigint() - start) / 1_000_000_000);
  }
}

export function getApiLatencySnapshot(intervalSeconds = 10) {
  const now = Date.now();
  pruneApiLatencySamples(now);
  const latencyWindow = apiLatencySamples.filter((sample) => sample.at >= now - API_LATENCY_WINDOW_MS).map((sample) => sample.ms);
  const intervalStart = now - intervalSeconds * 1000;
  const intervalCount = apiLatencySamples.filter((sample) => sample.at >= intervalStart).length;
  return {
    latency_p50: percentile(latencyWindow, 50),
    latency_p95: percentile(latencyWindow, 95),
    latency_p99: percentile(latencyWindow, 99),
    requests_per_sec: round(intervalCount / intervalSeconds)
  };
}

export function getMongoOperationSnapshot(limit = 20) {
  const now = Date.now();
  pruneMongoOperationSamples(now);
  const grouped = new Map<string, { operation: string; collection: string; samples: number[]; latestMs: number; lastSeenAt: number }>();
  for (const sample of mongoOperationSamples) {
    const key = `${sample.collection}:${sample.operation}`;
    const current = grouped.get(key) || { operation: sample.operation, collection: sample.collection, samples: [], latestMs: 0, lastSeenAt: 0 };
    current.samples.push(sample.ms);
    current.latestMs = sample.ms;
    current.lastSeenAt = sample.at;
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .map((item) => ({
      operation: item.operation,
      collection: item.collection,
      samples: item.samples.length,
      avgMs: round(item.samples.reduce((total, value) => total + value, 0) / Math.max(1, item.samples.length)),
      p95Ms: percentile(item.samples, 95),
      latestMs: round(item.latestMs),
      lastSeenAt: new Date(item.lastSeenAt).toISOString()
    }))
    .sort((left, right) => right.p95Ms - left.p95Ms)
    .slice(0, limit);
}

export function renderMetrics() {
  const lines: string[] = [];
  for (const [name, metric] of metrics) {
    lines.push(`# HELP ${name} ${metric.help}`);
    lines.push(`# TYPE ${name} ${metric.type}`);
    for (const [key, value] of metric.values) {
      const suffix = key ? `{${key}}` : '';
      if (metric.type === 'histogram' && key.includes('stat="sum"')) {
        lines.push(`${name}_sum${suffix.replace(/,?stat="sum"/, '')} ${value}`);
      } else if (metric.type === 'histogram') {
        lines.push(`${name}_bucket${suffix} ${value}`);
      } else {
        lines.push(`${name}${suffix} ${value}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

function getMetric(name: string, type: MetricRecord['type'], help: string) {
  const existing = metrics.get(name);
  if (existing) return existing;
  const metric: MetricRecord = { type, help, values: new Map() };
  metrics.set(name, metric);
  return metric;
}

function labelKey(labels: Labels) {
  return Object.entries(labels)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}="${escapeLabel(String(value))}"`)
    .join(',');
}

function escapeLabel(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function pruneApiLatencySamples(now: number) {
  const cutoff = now - API_LATENCY_WINDOW_MS;
  while (apiLatencySamples.length && apiLatencySamples[0].at < cutoff) apiLatencySamples.shift();
}

function pruneMongoOperationSamples(now: number) {
  const cutoff = now - MONGO_OPERATION_WINDOW_MS;
  while (mongoOperationSamples.length && mongoOperationSamples[0].at < cutoff) mongoOperationSamples.shift();
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
