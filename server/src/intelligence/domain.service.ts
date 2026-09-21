import { DomainProfile } from '../models/DomainProfile.js';
import { Page } from '../models/Page.js';
import { SOCIAL_KEYS } from '../extractors/social.js';
import { lookupDns } from './dns.service.js';
import { lookupWhois } from './whois.service.js';
import { timeMongoOperation } from '../utils/metrics.js';
import { DISABLE_METRICS } from '../utils/featureFlags.js';

const ENRICHMENT_TTL_MS = 60 * 24 * 60 * 60 * 1000;

export async function rebuildDomainProfile(deviceId: string, domain: string) {
  const canonicalDomain = normalizeDomainName(domain);
  const [profile] = await timeMongoOperation('rebuildDomainProfile.aggregate', 'pages', () => Page.aggregate<ReturnType<typeof buildDomainProfileData>>([
    { $match: { deviceId, domain: { $in: domainAliases(canonicalDomain) }, status: 'crawled' } },
    {
      $project: {
        url: 1,
        emails: { $ifNull: ['$emails', []] },
        social: 1,
        socialValues: { $concatArrays: SOCIAL_KEYS.map((key) => ({ $ifNull: [`$social.${key}`, []] })) },
        techStack: { $ifNull: ['$techStack', []] },
        pageType: { $ifNull: ['$classification.pageType', 'general'] },
        score: { $ifNull: ['$score', 0] },
        crawledAt: 1
      }
    },
    {
      $group: {
        _id: null,
        totalPages: { $sum: 1 },
        urls: { $addToSet: '$url' },
        emailsNested: { $push: '$emails' },
        rawEmailOccurrences: { $sum: { $size: '$emails' } },
        socialValuesNested: { $push: '$socialValues' },
        rawSocialOccurrences: { $sum: { $size: '$socialValues' } },
        techStackNested: { $push: '$techStack' },
        pageTypes: { $push: '$pageType' },
        avgScore: { $avg: '$score' },
        lastCrawledAt: { $max: '$crawledAt' },
        ...Object.fromEntries(SOCIAL_KEYS.map((key) => [`social_${key}`, { $push: { $ifNull: [`$social.${key}`, []] } }]))
      }
    }
  ]).then((rows) => rows.map((row) => buildDomainProfileDataFromAggregate(row as DomainProfileAggregateRow))));
  const nextProfile = profile || buildDomainProfileData([]);

  const updated = !DISABLE_METRICS ? await DomainProfile.findOneAndUpdate(
    { deviceId, domain: canonicalDomain },
    {
      $set: {
        totalPages: nextProfile.totalPages,
        emails: nextProfile.emails,
        socials: nextProfile.socials,
        contentCategories: nextProfile.contentCategories,
        counts: nextProfile.counts,
        avgScore: nextProfile.avgScore,
        techStack: nextProfile.techStack,
        ...(nextProfile.lastCrawledAt ? { lastCrawledAt: nextProfile.lastCrawledAt } : {})
      },
      ...(nextProfile.lastCrawledAt ? {} : { $unset: { lastCrawledAt: '' } })
    },
    { upsert: true, new: true }
  ) : null;

  if (!DISABLE_METRICS) {
    await DomainProfile.deleteMany({
      deviceId,
      domain: { $in: domainAliases(canonicalDomain).filter((alias) => alias !== canonicalDomain) }
    }).catch(() => undefined);
  }

  return updated;
}

export async function enrichDomain(deviceId: string, domain: string, force = false) {
  const canonicalDomain = normalizeDomainName(domain);
  const profile = await rebuildDomainProfile(deviceId, canonicalDomain);
  const refreshedAt = profile?.enrichmentRefreshedAt ? new Date(profile.enrichmentRefreshedAt).getTime() : 0;
  if (!force && refreshedAt && Date.now() - refreshedAt < ENRICHMENT_TTL_MS) return profile;

  const [whois, dns] = await Promise.all([
    lookupWhois(domain).then((value) => ({ ...value, refreshedAt: new Date() })).catch((error) => ({ error: error instanceof Error ? error.message : 'WHOIS failed', refreshedAt: new Date() })),
    lookupDns(domain).then((value) => ({ ...value, refreshedAt: new Date() })).catch((error) => ({ error: error instanceof Error ? error.message : 'DNS failed', refreshedAt: new Date() }))
  ]);

  if (DISABLE_METRICS) return profile;
  return DomainProfile.findOneAndUpdate(
    { deviceId, domain: canonicalDomain },
    { $set: { whois, dns, enrichmentRefreshedAt: new Date() } },
    { upsert: true, new: true }
  );
}

interface DomainProfilePage {
  url?: string;
  emails?: string[];
  social?: Record<string, string[] | undefined>;
  classification?: { pageType?: string };
  techStack?: string[];
  score?: number;
  crawledAt?: Date | string;
}

interface DomainProfileAggregateRow {
  totalPages?: number;
  urls?: string[];
  emailsNested?: string[][];
  rawEmailOccurrences?: number;
  socialValuesNested?: string[][];
  rawSocialOccurrences?: number;
  techStackNested?: string[][];
  pageTypes?: string[];
  avgScore?: number;
  lastCrawledAt?: Date | string | null;
  [key: `social_${string}`]: string[][] | undefined;
}

export function buildDomainProfileData(pages: DomainProfilePage[]) {
  const emails = [...new Set(pages.flatMap((page) => page.emails || []).map((email) => String(email).toLowerCase()))].sort();
  const socials = SOCIAL_KEYS.reduce<Record<string, string[]>>((result, key) => {
    result[key] = [...new Set(pages.flatMap((page) => page.social?.[key] || []).map(String))].sort();
    return result;
  }, {});
  const contentCategories = pages.reduce<Record<string, number>>((result, page) => {
    const pageType = page.classification?.pageType || 'general';
    result[pageType] = (result[pageType] || 0) + 1;
    return result;
  }, {});
  const techStack = [...new Set(pages.flatMap((page) => page.techStack || []).map(String))].sort();
  const avgScore = pages.length ? Math.round(pages.reduce((total, page) => total + (page.score || 0), 0) / pages.length) : 0;
  const lastCrawledAt = pages.reduce<Date | null>((latest, page) => {
    const crawledAt = page.crawledAt ? new Date(page.crawledAt) : null;
    if (!crawledAt || Number.isNaN(crawledAt.getTime())) return latest;
    return !latest || crawledAt > latest ? crawledAt : latest;
  }, null);
  const rawSocialOccurrences = pages.reduce((total, page) => (
    total + Object.values(page.social || {}).reduce((platformTotal, values) => platformTotal + (values || []).length, 0)
  ), 0);

  return {
    totalPages: pages.length,
    emails,
    socials,
    contentCategories,
    avgScore,
    techStack,
    lastCrawledAt,
    counts: {
      rawEmailOccurrences: pages.reduce((total, page) => total + (page.emails || []).length, 0),
      rawSocialOccurrences,
      uniqueEmails: emails.length,
      uniqueSocialProfiles: Object.values(socials).reduce((total, values) => total + values.length, 0),
      uniquePages: new Set(pages.map((page) => page.url).filter(Boolean).map(String)).size
    }
  };
}

function buildDomainProfileDataFromAggregate(row: DomainProfileAggregateRow) {
  const allEmails = (row.emailsNested || []).flat().map((email) => String(email).toLowerCase());
  const emails = [...new Set(allEmails)].sort();
  const socials = SOCIAL_KEYS.reduce<Record<string, string[]>>((result, key) => {
    result[key] = [...new Set(((row[`social_${key}`] || []) as string[][]).flat().map(String))].sort();
    return result;
  }, {});
  const contentCategories = (row.pageTypes || []).reduce<Record<string, number>>((result, pageType) => {
    const key = pageType || 'general';
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
  const techStack = [...new Set((row.techStackNested || []).flat().map(String))].sort();
  const lastCrawledAt = row.lastCrawledAt ? new Date(row.lastCrawledAt) : null;

  return {
    totalPages: row.totalPages || 0,
    emails,
    socials,
    contentCategories,
    avgScore: row.totalPages ? Math.round(row.avgScore || 0) : 0,
    techStack,
    lastCrawledAt: lastCrawledAt && !Number.isNaN(lastCrawledAt.getTime()) ? lastCrawledAt : null,
    counts: {
      rawEmailOccurrences: row.rawEmailOccurrences || 0,
      rawSocialOccurrences: row.rawSocialOccurrences || 0,
      uniqueEmails: emails.length,
      uniqueSocialProfiles: Object.values(socials).reduce((total, values) => total + values.length, 0),
      uniquePages: new Set((row.urls || []).filter(Boolean).map(String)).size
    }
  };
}

export function normalizeDomainName(domain: string) {
  return domain.trim().toLowerCase().replace(/^www\./, '');
}

function domainAliases(domain: string) {
  const canonical = normalizeDomainName(domain);
  return canonical ? [canonical, `www.${canonical}`] : [];
}
