import mongoose from 'mongoose';

const workspaceSettingsSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true, index: true },
  workspaceId: { type: String, index: true },
  account: {
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    profileImage: { type: String, default: '' }
  },
  workspace: {
    name: { type: String, default: 'Local workspace' },
    logo: { type: String, default: '' }
  },
  notifications: {
    inApp: { type: String, enum: ['all', 'important', 'disabled'], default: 'important' },
    email: { type: String, enum: ['instant', 'daily', 'weekly', 'disabled'], default: 'disabled' },
    events: {
      pricingChanges: { type: Boolean, default: true },
      emailDiscoveries: { type: Boolean, default: true },
      dnsChanges: { type: Boolean, default: true },
      whoisChanges: { type: Boolean, default: true },
      techStackChanges: { type: Boolean, default: true },
      newPages: { type: Boolean, default: true }
    }
  },
  crawling: {
    defaultDepth: { type: Number, default: 2 },
    maxPages: { type: Number, default: 500 },
    respectRobots: { type: Boolean, default: false },
    crawlDelaySeconds: { type: Number, default: 1 },
    userAgentMode: { type: String, enum: ['default', 'custom'], default: 'default' },
    customUserAgent: { type: String, default: '' }
  },
  monitoring: {
    preset: {
      type: String,
      enum: ['competitive_intelligence', 'lead_discovery', 'seo_monitoring', 'infrastructure_monitoring', 'custom'],
      default: 'competitive_intelligence'
    },
    defaultFrequency: { type: String, enum: ['daily', 'weekly', 'monthly'], default: 'daily' },
    autoMonitorImportantPages: { type: Boolean, default: true },
    sensitivity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' }
  },
  dataRetention: {
    retentionDays: { type: Number, enum: [30, 90, 180, 365], default: 90 },
    autoDelete: { type: Boolean, default: true },
    exportFormat: { type: String, enum: ['csv', 'json'], default: 'json' }
  },
  integrations: {
    webhookUrl: { type: String, default: '' },
    webhookSecret: { type: String, default: '' },
    webhookEvents: { type: [String], default: ['change_detected', 'new_email'] }
  },
  appearance: {
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    density: { type: String, enum: ['comfortable', 'compact'], default: 'comfortable' }
  }
}, { timestamps: true });

export const WorkspaceSettings = mongoose.model('WorkspaceSettings', workspaceSettingsSchema);
