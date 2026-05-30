type Labels = Record<string, string | number | boolean | undefined>;

interface MetricRecord {
  type: 'counter' | 'gauge' | 'histogram';
  help: string;
  values: Map<string, number>;
}

const metrics = new Map<string, MetricRecord>();
const histogramBuckets = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

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
