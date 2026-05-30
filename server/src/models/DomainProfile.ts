import mongoose from 'mongoose';
import type { SocialLinks } from '../types.js';

const socialSchema = new mongoose.Schema({}, { _id: false, strict: false });

const whoisSchema = new mongoose.Schema({
  registrar: String,
  creationDate: Date,
  expiryDate: Date,
  updatedDate: Date,
  registrantCountry: String,
  nameServers: { type: [String], default: [] },
  error: String,
  refreshedAt: Date
}, { _id: false });

const dnsSchema = new mongoose.Schema({
  mxRecords: { type: [Object], default: [] },
  aRecords: { type: [String], default: [] },
  txtRecords: { type: [[String]], default: [] },
  mailProviderGuess: { type: String, default: 'Unknown' },
  error: String,
  refreshedAt: Date
}, { _id: false });

const domainProfileSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  domain: { type: String, required: true, index: true },
  totalPages: { type: Number, default: 0 },
  emails: { type: [String], default: [] },
  socials: { type: socialSchema, default: () => ({}) },
  contentCategories: { type: Object, default: () => ({}) },
  avgScore: { type: Number, default: 0 },
  whois: { type: whoisSchema, default: () => ({}) },
  dns: { type: dnsSchema, default: () => ({}) },
  techStack: { type: [String], default: [] },
  lastCrawledAt: Date,
  enrichmentRefreshedAt: Date
}, { timestamps: true });

domainProfileSchema.index({ deviceId: 1, domain: 1 }, { unique: true });
domainProfileSchema.index({ deviceId: 1, avgScore: -1 });

export interface IDomainProfile {
  deviceId: string;
  domain: string;
  totalPages: number;
  emails: string[];
  socials: Partial<SocialLinks>;
  contentCategories: Record<string, number>;
  avgScore: number;
  whois?: {
    registrar?: string;
    creationDate?: Date;
    expiryDate?: Date;
    updatedDate?: Date;
    registrantCountry?: string;
    nameServers?: string[];
    error?: string;
    refreshedAt?: Date;
  };
  dns?: {
    mxRecords?: unknown[];
    aRecords?: string[];
    txtRecords?: string[][];
    mailProviderGuess?: string;
    error?: string;
    refreshedAt?: Date;
  };
  techStack: string[];
  lastCrawledAt?: Date;
  enrichmentRefreshedAt?: Date;
}

export const DomainProfile = mongoose.model<IDomainProfile>('DomainProfile', domainProfileSchema);
