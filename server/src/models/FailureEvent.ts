import mongoose from 'mongoose';

export const failureTypes = [
  'rate_limited_429',
  'forbidden_403',
  'captcha',
  'proxy_failure',
  'timeout',
  'dns_failure',
  'parser_error',
  'database_error',
  'network_error',
  'queue_stalled',
  'unknown'
] as const;

const failureEventSchema = new mongoose.Schema({
  // Indexed for time range scans and TTL expiry.
  timestamp: { type: Date, required: true, default: Date.now, index: { expires: '30d' } },
  job_id: { type: String, index: true },
  domain: { type: String, index: true },
  worker_id: { type: String, index: true },
  failure_type: { type: String, enum: failureTypes, default: 'unknown', index: true },
  http_status: { type: Number, default: null },
  error_message: { type: String, default: '' },
  stack_trace: { type: String, default: '' },
  retry_count: { type: Number, default: 0 },
  is_terminal: { type: Boolean, default: false },
  proxy_used: { type: String, default: '' },
  user_agent_used: { type: String, default: '' },
  url_attempted: { type: String, default: '' }
});

failureEventSchema.index({ timestamp: -1 });
failureEventSchema.index({ failure_type: 1, timestamp: -1 });
failureEventSchema.index({ domain: 1, timestamp: -1 });

export const FailureEvent = mongoose.model('FailureEvent', failureEventSchema);
