import mongoose from 'mongoose';

const alertEventSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  type: {
    type: String,
    enum: ['new_email', 'page_changed', 'new_domain', 'crawl_failed', 'change_detected', 'webhook_failed'],
    required: true,
    index: true
  },
  severity: { type: String, enum: ['low', 'medium', 'high'], default: 'low', index: true },
  domain: { type: String, index: true },
  crawlId: { type: mongoose.Schema.Types.ObjectId, ref: 'CrawlJob', default: null },
  pageUrl: String,
  message: { type: String, required: true },
  metadata: { type: Object, default: () => ({}) },
  readAt: { type: Date, default: null }
}, { timestamps: true });

alertEventSchema.index({ deviceId: 1, createdAt: -1 });
alertEventSchema.index({ deviceId: 1, type: 1, createdAt: -1, 'metadata.emails': 1 });

export const AlertEvent = mongoose.model('AlertEvent', alertEventSchema);
