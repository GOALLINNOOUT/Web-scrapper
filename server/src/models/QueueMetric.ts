import mongoose from 'mongoose';

const queueCountsSchema = new mongoose.Schema({
  waiting: { type: Number, default: 0 },
  active: { type: Number, default: 0 },
  completed: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  delayed: { type: Number, default: 0 },
  paused: { type: Number, default: 0 }
}, { _id: false });

const queueMetricSchema = new mongoose.Schema({
  // Indexed for time range scans and TTL expiry.
  timestamp: { type: Date, required: true, default: Date.now, index: { expires: '30d' } },
  crawl_queue: { type: queueCountsSchema, default: () => ({}) },
  retry_queue: { type: queueCountsSchema, default: () => ({}) },
  dead_letter_queue: {
    count: { type: Number, default: 0 }
  },
  crawl_breakdown: {
    active_page_jobs: { type: Number, default: 0 },
    running_crawls: { type: Number, default: 0 },
    queued_crawls: { type: Number, default: 0 },
    worker_concurrency: { type: Number, default: 0 }
  },
  total_backlog: { type: Number, default: 0 },
  backlog_growth_rate_per_min: { type: Number, default: 0 },
  estimated_drain_time_minutes: { type: Number, default: 0 }
}, { minimize: false });

queueMetricSchema.index({ timestamp: -1 });

export const QueueMetric = mongoose.model('QueueMetric', queueMetricSchema);
