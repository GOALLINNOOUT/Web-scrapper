import mongoose from 'mongoose';

const workerMetricSchema = new mongoose.Schema({
  // Indexed for time range scans and TTL expiry.
  timestamp: { type: Date, required: true, default: Date.now, index: { expires: '30d' } },
  worker_id: { type: String, required: true, index: true },
  worker_name: { type: String, required: true },
  status: { type: String, enum: ['active', 'idle', 'crashed', 'restarting'], default: 'idle', index: true },
  cpu_percent: { type: Number, default: 0 },
  memory_mb: { type: Number, default: 0 },
  jobs_running: { type: Number, default: 0 },
  jobs_completed_total: { type: Number, default: 0 },
  jobs_failed_total: { type: Number, default: 0 },
  pages_per_sec: { type: Number, default: 0 },
  restart_count: { type: Number, default: 0 },
  last_restart_at: { type: Date, default: null },
  uptime_seconds: { type: Number, default: 0 },
  failure_rate_percent: { type: Number, default: 0 }
});

workerMetricSchema.index({ timestamp: -1 });
workerMetricSchema.index({ worker_id: 1, timestamp: -1 });

export const WorkerMetric = mongoose.model('WorkerMetric', workerMetricSchema);
