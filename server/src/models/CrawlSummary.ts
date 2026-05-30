import mongoose from 'mongoose';

const occurrenceSchema = new mongoose.Schema({
  value: { type: String, required: true },
  pageUrl: { type: String, required: true }
}, { _id: false });

const socialOccurrenceSchema = new mongoose.Schema({
  platform: { type: String, required: true },
  value: { type: String, required: true },
  pageUrl: { type: String, required: true }
}, { _id: false });

const socialGroupSchema = new mongoose.Schema({
  platform: { type: String, required: true },
  links: { type: [String], default: [] }
}, { _id: false });

const crawlSummarySchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  crawlId: { type: mongoose.Schema.Types.ObjectId, ref: 'CrawlJob', required: true, index: true },
  emails: { type: [String], default: [] },
  emailOccurrences: { type: [occurrenceSchema], default: [] },
  socials: { type: [socialGroupSchema], default: [] },
  socialOccurrences: { type: [socialOccurrenceSchema], default: [] },
  techStack: { type: [String], default: [] },
  counts: {
    uniqueEmails: { type: Number, default: 0 },
    uniqueSocialProfiles: { type: Number, default: 0 },
    uniqueTech: { type: Number, default: 0 },
    loadedPages: { type: Number, default: 0 },
    rawEmailOccurrences: { type: Number, default: 0 },
    rawSocialOccurrences: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

crawlSummarySchema.index({ deviceId: 1, crawlId: 1 }, { unique: true });

export const CrawlSummary = mongoose.model('CrawlSummary', crawlSummarySchema);
