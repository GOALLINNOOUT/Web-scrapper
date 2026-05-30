import mongoose from 'mongoose';
import type { Metadata, SocialLinks } from '../types.js';

export interface IPage {
  deviceId: string;
  workspaceId?: string;
  crawlId: mongoose.Types.ObjectId | string;
  url: string;
  domain: string;
  depth: number;
  parentUrl?: string | null;
  parentPageId?: mongoose.Types.ObjectId | string | null;
  discoveredFrom?: string | null;
  metadata: Metadata;
  links: string[];
  emails: string[];
  social: SocialLinks;
  techStack: string[];
  content: {
    text: string;
    headings: string[];
    paragraphs: string[];
    wordCount: number;
  };
  classification: {
    pageType: string;
    confidence: number;
  };
  score: number;
  status: 'crawled' | 'failed' | 'skipped';
  searchText: string;
  crawledAt: Date;
  contentHash: string;
  expiresAt: Date;
}

const metadataSchema = new mongoose.Schema({
  title: String,
  description: String,
  canonical: String,
  language: String,
  viewport: String,
  robots: String,
  author: String,
  publisher: String,
  generator: String,
  applicationName: String,
  keywords: { type: [String], default: [] },
  themeColor: String,
  favicon: String,
  manifest: String,
  ampUrl: String,
  alternateLanguages: { type: [Object], default: [] },
  ogUrl: String,
  ogType: String,
  ogTitle: String,
  ogDescription: String,
  ogImage: String,
  siteName: String,
  twitterCard: String,
  twitterSite: String,
  twitterCreator: String,
  twitterTitle: String,
  twitterDescription: String,
  twitterImage: String,
  jsonLdTypes: { type: [String], default: [] }
}, { _id: false });

const socialSchema = new mongoose.Schema({
  twitter: { type: [String], default: [] },
  linkedin: { type: [String], default: [] },
  instagram: { type: [String], default: [] },
  facebook: { type: [String], default: [] },
  github: { type: [String], default: [] },
  youtube: { type: [String], default: [] },
  tiktok: { type: [String], default: [] },
  reddit: { type: [String], default: [] },
  pinterest: { type: [String], default: [] },
  snapchat: { type: [String], default: [] },
  telegram: { type: [String], default: [] },
  whatsapp: { type: [String], default: [] },
  discord: { type: [String], default: [] },
  medium: { type: [String], default: [] },
  devto: { type: [String], default: [] },
  behance: { type: [String], default: [] },
  dribbble: { type: [String], default: [] },
  stackoverflow: { type: [String], default: [] },
  gitlab: { type: [String], default: [] },
  bitbucket: { type: [String], default: [] },
  threads: { type: [String], default: [] },
  mastodon: { type: [String], default: [] },
  bluesky: { type: [String], default: [] },
  twitch: { type: [String], default: [] },
  vimeo: { type: [String], default: [] },
  substack: { type: [String], default: [] },
  quora: { type: [String], default: [] },
  wechat: { type: [String], default: [] },
  weibo: { type: [String], default: [] },
  line: { type: [String], default: [] },
  kakaotalk: { type: [String], default: [] },
  patreon: { type: [String], default: [] },
  buymeacoffee: { type: [String], default: [] },
  linktree: { type: [String], default: [] },
  calendly: { type: [String], default: [] }
}, { _id: false });

const contentSchema = new mongoose.Schema({
  text: { type: String, default: '' },
  headings: { type: [String], default: [] },
  paragraphs: { type: [String], default: [] },
  wordCount: { type: Number, default: 0 }
}, { _id: false });

const classificationSchema = new mongoose.Schema({
  pageType: { type: String, default: 'general', index: true },
  confidence: { type: Number, default: 0 }
}, { _id: false });

function sevenDaysFromNow() {
  const days = Number(process.env.DATA_RETENTION_DAYS || 7);
  return new Date(Date.now() + (Number.isFinite(days) && days > 0 ? days : 7) * 24 * 60 * 60 * 1000);
}

const pageSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  workspaceId: { type: String, index: true },
  crawlId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CrawlJob',
    required: true,
    index: true
  },
  url: { type: String, required: true, index: true },
  domain: { type: String, required: true, index: true },
  depth: { type: Number, required: true },
  parentUrl: { type: String, default: null, index: true },
  parentPageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Page', default: null, index: true },
  discoveredFrom: { type: String, default: null },
  metadata: { type: metadataSchema, default: () => ({}) },
  links: { type: [String], default: [] },
  emails: { type: [String], default: [] },
  social: { type: socialSchema, default: () => ({}) },
  techStack: { type: [String], default: [], index: true },
  content: { type: contentSchema, default: () => ({}) },
  classification: { type: classificationSchema, default: () => ({}) },
  score: { type: Number, default: 0, index: true },
  status: { type: String, enum: ['crawled', 'failed', 'skipped'], default: 'crawled', index: true },
  searchText: { type: String, default: '' },
  crawledAt: { type: Date, default: Date.now },
  contentHash: { type: String, required: true },
  expiresAt: { type: Date, default: sevenDaysFromNow, index: { expires: 0 } }
});

pageSchema.index({ deviceId: 1, crawlId: 1, url: 1 }, { unique: true });
pageSchema.index({ workspaceId: 1, domain: 1 });
pageSchema.index({ workspaceId: 1, 'classification.pageType': 1, score: -1 });
pageSchema.index({ workspaceId: 1, crawledAt: -1 });
pageSchema.index({ workspaceId: 1, techStack: 1 });
pageSchema.index({ deviceId: 1, crawlId: 1, crawledAt: -1, _id: -1 });
pageSchema.index({ deviceId: 1, crawlId: 1, depth: 1, crawledAt: 1 });
pageSchema.index({ deviceId: 1, crawlId: 1, parentUrl: 1 });
pageSchema.index({ deviceId: 1, crawledAt: -1, _id: -1 });
pageSchema.index({ deviceId: 1, domain: 1, crawledAt: -1 });
pageSchema.index({ deviceId: 1, domain: 1, score: -1 });
pageSchema.index({ deviceId: 1, 'classification.pageType': 1, score: -1 });
pageSchema.index({ deviceId: 1, techStack: 1 });
pageSchema.index({ deviceId: 1, searchText: 'text' });
pageSchema.index({ deviceId: 1, status: 1, crawledAt: -1, _id: -1 });
pageSchema.index({ deviceId: 1, 'emails.0': 1, crawledAt: -1 });
pageSchema.index({ deviceId: 1, 'social.linkedin.0': 1, crawledAt: -1 });
pageSchema.index({ deviceId: 1, 'social.twitter.0': 1, crawledAt: -1 });
pageSchema.index({ deviceId: 1, 'social.instagram.0': 1, crawledAt: -1 });
pageSchema.index({ deviceId: 1, 'social.facebook.0': 1, crawledAt: -1 });
pageSchema.index({ deviceId: 1, 'social.github.0': 1, crawledAt: -1 });
pageSchema.index({ deviceId: 1, 'social.youtube.0': 1, crawledAt: -1 });
pageSchema.index({ 'emails.0': 1 });
pageSchema.index({ 'social.linkedin.0': 1 });
pageSchema.index({ 'social.twitter.0': 1 });
pageSchema.index({ 'social.instagram.0': 1 });
pageSchema.index({ 'social.facebook.0': 1 });
pageSchema.index({ 'social.github.0': 1 });
pageSchema.index({ 'social.youtube.0': 1 });

export const Page = mongoose.model<IPage>('Page', pageSchema);
