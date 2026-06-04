import mongoose from 'mongoose';

const monitoredPageSchema = new mongoose.Schema({
  url: { type: String, required: true },
  label: { type: String, default: '' },
  reason: { type: String, default: '' },
  score: { type: Number, default: 0 },
  enabled: { type: Boolean, default: true },
  signals: { type: [String], default: ['content', 'metadata', 'emails', 'social', 'tech'] },
  lastCheckedAt: { type: Date, default: null }
}, { _id: false });

const monitoringProfileSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  workspaceId: { type: String, index: true },
  domain: { type: String, required: true, index: true },
  seedUrl: { type: String, required: true },
  monitoringType: {
    type: String,
    enum: ['competitive_intelligence', 'lead_discovery', 'seo_monitoring', 'infrastructure_monitoring', 'custom'],
    default: 'competitive_intelligence',
    index: true
  },
  monitoredPages: { type: [monitoredPageSchema], default: [] },
  recommendedPages: { type: [monitoredPageSchema], default: [] },
  schedule: { type: String, enum: ['12h', 'daily', 'weekly', 'monthly'], default: 'daily' },
  sensitivity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  enabled: { type: Boolean, default: true, index: true },
  lastCheckedAt: { type: Date, default: null },
  lastChangeAt: { type: Date, default: null },
  discoveryCrawlId: { type: mongoose.Schema.Types.ObjectId, ref: 'CrawlJob', default: null }
}, { timestamps: true });

monitoringProfileSchema.index({ deviceId: 1, domain: 1 }, { unique: true });
monitoringProfileSchema.index({ deviceId: 1, enabled: 1, lastCheckedAt: 1 });
monitoringProfileSchema.index({ deviceId: 1, enabled: 1, domain: 1 });

export const MonitoringProfile = mongoose.model('MonitoringProfile', monitoringProfileSchema);
