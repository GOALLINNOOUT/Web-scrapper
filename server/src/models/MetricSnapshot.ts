import mongoose from 'mongoose';

const providerBreakdownSchema = new mongoose.Schema({
  name: { type: String, required: true },
  utilization: { type: Number, default: 0 },
  success_rate: { type: Number, default: 100 }
}, { _id: false });

const metricSnapshotSchema = new mongoose.Schema({
  // Indexed for time range scans and TTL expiry.
  timestamp: { type: Date, required: true, default: Date.now, index: { expires: '30d' } },
  interval: { type: Number, default: 10 },
  api: {
    cpu: { type: Number, default: 0 },
    memory: { type: Number, default: 0 },
    network_in: { type: Number, default: 0 },
    network_out: { type: Number, default: 0 },
    disk_read: { type: Number, default: 0 },
    disk_write: { type: Number, default: 0 },
    latency_p50: { type: Number, default: 0 },
    latency_p95: { type: Number, default: 0 },
    latency_p99: { type: Number, default: 0 },
    uptime_seconds: { type: Number, default: 0 },
    requests_per_sec: { type: Number, default: 0 }
  },
  workers: {
    total: { type: Number, default: 0 },
    active: { type: Number, default: 0 },
    idle: { type: Number, default: 0 },
    crashed: { type: Number, default: 0 },
    avg_cpu: { type: Number, default: 0 },
    avg_memory: { type: Number, default: 0 },
    total_jobs_per_sec: { type: Number, default: 0 },
    total_pages_per_sec: { type: Number, default: 0 },
    total_failure_rate: { type: Number, default: 0 }
  },
  redis: {
    memory_used: { type: Number, default: 0 },
    memory_peak: { type: Number, default: 0 },
    maxmemory: { type: Number, default: 0 },
    commands_per_sec: { type: Number, default: 0 },
    latency_ms: { type: Number, default: 0 },
    connected_clients: { type: Number, default: 0 },
    queue_throughput: { type: Number, default: 0 }
  },
  mongodb: {
    queries_per_sec: { type: Number, default: 0 },
    latency_p50: { type: Number, default: 0 },
    latency_p95: { type: Number, default: 0 },
    latency_p99: { type: Number, default: 0 },
    connections_active: { type: Number, default: 0 },
    slow_queries_count: { type: Number, default: 0 },
    storage_used_mb: { type: Number, default: 0 },
    storage_total_mb: { type: Number, default: 0 },
    storage_free_mb: { type: Number, default: 0 },
    storage_used_gb: { type: Number, default: 0 },
    storage_total_gb: { type: Number, default: 0 },
    storage_free_gb: { type: Number, default: 0 },
    storage_used_percent: { type: Number, default: 0 }
  },
  proxy_pool: {
    total_proxies: { type: Number, default: 0 },
    active_proxies: { type: Number, default: 0 },
    requests_total: { type: Number, default: 0 },
    success_rate: { type: Number, default: 100 },
    avg_response_time_ms: { type: Number, default: 0 },
    provider_breakdown: { type: [providerBreakdownSchema], default: [] }
  },
  system_totals: {
    requests_per_sec: { type: Number, default: 0 },
    pages_per_sec: { type: Number, default: 0 },
    jobs_per_sec: { type: Number, default: 0 },
    domains_per_sec: { type: Number, default: 0 },
    active_crawls: { type: Number, default: 0 },
    queued_crawls: { type: Number, default: 0 },
    running_crawls: { type: Number, default: 0 },
    completed_crawls: { type: Number, default: 0 },
    failed_crawls: { type: Number, default: 0 }
  }
}, { minimize: false });

metricSnapshotSchema.index({ timestamp: -1 });

export const MetricSnapshot = mongoose.model('MetricSnapshot', metricSnapshotSchema);
