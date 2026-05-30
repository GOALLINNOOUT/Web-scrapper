import mongoose from 'mongoose';

const extractSchema = new mongoose.Schema({
  links: { type: Boolean, default: true },
  emails: { type: Boolean, default: true },
  metadata: { type: Boolean, default: true },
  social: { type: Boolean, default: true },
  content: { type: Boolean, default: true }
}, { _id: false });

const discoverySchema = new mongoose.Schema({
  sitemap: { type: Boolean, default: true },
  renderJavaScript: { type: Boolean, default: true },
  renderWhenStaticLinksBelow: { type: Number, default: 20 },
  includeMetaLinks: { type: Boolean, default: true }
}, { _id: false });

const configSchema = new mongoose.Schema({
  seedUrl: { type: String, required: true },
  maxPages: { type: Number, default: 100 },
  maxDepth: { type: Number, default: 2 },
  sameDomainOnly: { type: Boolean, default: true },
  concurrency: { type: Number, default: 5 },
  discovery: { type: discoverySchema, default: () => ({}) },
  extract: { type: extractSchema, default: () => ({}) },
  schedule: { type: String, enum: ['none', 'daily', 'weekly'], default: 'none' }
}, { _id: false });

function sevenDaysFromNow() {
  const days = Number(process.env.DATA_RETENTION_DAYS || 7);
  return new Date(Date.now() + (Number.isFinite(days) && days > 0 ? days : 7) * 24 * 60 * 60 * 1000);
}

const crawlJobSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  seedUrl: { type: String, required: true, index: true },
  status: {
    type: String,
    enum: ['queued', 'running', 'paused', 'completed', 'stopped', 'failed'],
    default: 'queued',
    index: true
  },
  config: { type: configSchema, required: true },
  pagesCrawled: { type: Number, default: 0 },
  emailsFound: { type: Number, default: 0 },
  socialLinksFound: { type: Number, default: 0 },
  requestedStop: { type: Boolean, default: false },
  requestedPause: { type: Boolean, default: false },
  error: { type: String, default: null },
  queueJobId: { type: String, default: null },
  durationMs: { type: Number, default: 0 },
  deadLetterReason: { type: String, default: null },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: sevenDaysFromNow, index: { expires: 0 } }
}, {
  timestamps: true
});

crawlJobSchema.index({ deviceId: 1, createdAt: -1 });
crawlJobSchema.index({ deviceId: 1, status: 1, createdAt: -1 });

export const CrawlJob = mongoose.model('CrawlJob', crawlJobSchema);
