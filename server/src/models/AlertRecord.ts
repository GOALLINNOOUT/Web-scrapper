import mongoose from 'mongoose';

const evidenceSchema = new mongoose.Schema({
  metric: { type: String, required: true },
  value: { type: Number, required: true },
  threshold: { type: Number, required: true },
  unit: { type: String, default: '' }
}, { _id: false });

const alertRecordSchema = new mongoose.Schema({
  // Indexed for time range scans and TTL expiry.
  timestamp: { type: Date, required: true, default: Date.now, index: { expires: '30d' } },
  alert_id: { type: String, required: true, unique: true, index: true },
  alert_key: { type: String, required: true, index: true },
  severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info', index: true },
  component: { type: String, enum: ['api', 'workers', 'redis', 'mongodb', 'proxy_pool', 'queue', 'domain'], required: true, index: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  suggestion: { type: String, default: '' },
  evidence: { type: [evidenceSchema], default: [] },
  status: { type: String, enum: ['active', 'resolved'], default: 'active', index: true },
  resolved_at: { type: Date, default: null },
  duration_seconds: { type: Number, default: null }
});

alertRecordSchema.index({ timestamp: -1 });
alertRecordSchema.index({ status: 1, timestamp: -1 });
alertRecordSchema.index({ alert_key: 1, status: 1 });

export const AlertRecord = mongoose.model('AlertRecord', alertRecordSchema);
