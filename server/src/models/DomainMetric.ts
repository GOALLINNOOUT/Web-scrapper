import mongoose from 'mongoose';

const domainMetricSchema = new mongoose.Schema({
  // Indexed for time range scans and TTL expiry.
  timestamp: { type: Date, required: true, default: Date.now, index: { expires: '30d' } },
  domain: { type: String, required: true, index: true },
  sample_count: { type: Number, default: 0 },
  pages_crawled: { type: Number, default: 0 },
  success_count: { type: Number, default: 0 },
  failed_count: { type: Number, default: 0 },
  success_rate_percent: { type: Number, default: 100 },
  block_rate_percent: { type: Number, default: 0 },
  captcha_rate_percent: { type: Number, default: 0 },
  avg_response_time_ms: { type: Number, default: 0 },
  response_time_p50: { type: Number, default: 0 },
  response_time_p95: { type: Number, default: 0 },
  response_time_p99: { type: Number, default: 0 },
  rate_limit_hits: { type: Number, default: 0 },
  captcha_count: { type: Number, default: 0 },
  dns_failures: { type: Number, default: 0 },
  timeout_count: { type: Number, default: 0 }
});

domainMetricSchema.index({ timestamp: -1 });
domainMetricSchema.index({ domain: 1, timestamp: -1 });

export const DomainMetric = mongoose.model('DomainMetric', domainMetricSchema);
