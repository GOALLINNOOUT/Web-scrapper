import mongoose from 'mongoose';

const pageChangeSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  workspaceId: { type: String, index: true },
  url: { type: String, required: true, index: true },
  domain: { type: String, index: true },
  crawlId: { type: mongoose.Schema.Types.ObjectId, ref: 'CrawlJob', index: true },
  changeType: {
    type: String,
    enum: ['content_changed', 'new_emails', 'metadata_changed', 'score_changed'],
    required: true,
    index: true
  },
  severity: { type: String, enum: ['low', 'medium', 'high'], default: 'low', index: true },
  data: { type: Object, default: () => ({}) },
  detectedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

pageChangeSchema.index({ deviceId: 1, detectedAt: -1 });
pageChangeSchema.index({ workspaceId: 1, detectedAt: -1 });
pageChangeSchema.index({ deviceId: 1, domain: 1, detectedAt: -1 });

export const PageChange = mongoose.model('PageChange', pageChangeSchema);
