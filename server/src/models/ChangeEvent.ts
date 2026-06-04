import mongoose from 'mongoose';

const changeEventSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  workspaceId: { type: String, index: true },
  domain: { type: String, required: true, index: true },
  url: { type: String, default: '', index: true },
  eventType: {
    type: String,
    enum: [
      'content_changed',
      'heading_changed',
      'metadata_changed',
      'new_page',
      'removed_page',
      'new_email',
      'removed_email',
      'social_changed',
      'tech_stack_changed',
      'whois_changed',
      'dns_changed',
      'price_changed',
      'score_changed'
    ],
    required: true,
    index: true
  },
  oldValue: { type: Object, default: null },
  newValue: { type: Object, default: null },
  diff: { type: Object, default: () => ({}) },
  severity: { type: String, enum: ['low', 'medium', 'high'], default: 'low', index: true },
  reason: { type: String, default: '' },
  crawlId: { type: mongoose.Schema.Types.ObjectId, ref: 'CrawlJob', default: null },
  readAt: { type: Date, default: null },
  detectedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

changeEventSchema.index({ deviceId: 1, detectedAt: -1 });
changeEventSchema.index({ deviceId: 1, domain: 1, detectedAt: -1 });
changeEventSchema.index({ deviceId: 1, readAt: 1, detectedAt: -1 });
changeEventSchema.index({ workspaceId: 1, detectedAt: -1 });

export const ChangeEvent = mongoose.model('ChangeEvent', changeEventSchema);
