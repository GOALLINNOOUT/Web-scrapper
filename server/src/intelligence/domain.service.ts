import { DomainProfile } from '../models/DomainProfile.js';
import { Page } from '../models/Page.js';
import { SOCIAL_KEYS } from '../extractors/social.js';
import { lookupDns } from './dns.service.js';
import { lookupWhois } from './whois.service.js';

const ENRICHMENT_TTL_MS = 60 * 24 * 60 * 60 * 1000;

export async function rebuildDomainProfile(deviceId: string, domain: string) {
  const pages = await Page.aggregate([
    { $match: { deviceId, domain, status: 'crawled' } },
    { $sort: { crawledAt: -1, _id: -1 } },
    { $group: { _id: '$url', page: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$page' } }
  ]);
  const emails = [...new Set(pages.flatMap((page) => page.emails || []))];
  const socials = SOCIAL_KEYS.reduce<Record<string, string[]>>((result, key) => {
    result[key] = [...new Set(pages.flatMap((page) => page.social?.[key] || []))];
    return result;
  }, {});
  const contentCategories = pages.reduce<Record<string, number>>((result, page) => {
    const pageType = page.classification?.pageType || 'general';
    result[pageType] = (result[pageType] || 0) + 1;
    return result;
  }, {});
  const techStack = [...new Set(pages.flatMap((page) => page.techStack || []))].sort();
  const avgScore = pages.length ? Math.round(pages.reduce((total, page) => total + (page.score || 0), 0) / pages.length) : 0;
  const lastCrawledAt = pages.reduce<Date | null>((latest, page) => {
    const crawledAt = page.crawledAt ? new Date(page.crawledAt) : null;
    if (!crawledAt) return latest;
    return !latest || crawledAt > latest ? crawledAt : latest;
  }, null);

  return DomainProfile.findOneAndUpdate(
    { deviceId, domain },
    {
      $set: {
        totalPages: pages.length,
        emails,
        socials,
        contentCategories,
        avgScore,
        techStack,
        ...(lastCrawledAt ? { lastCrawledAt } : {})
      },
      ...(lastCrawledAt ? {} : { $unset: { lastCrawledAt: '' } })
    },
    { upsert: true, new: true }
  );
}

export async function enrichDomain(deviceId: string, domain: string, force = false) {
  const profile = await rebuildDomainProfile(deviceId, domain);
  const refreshedAt = profile.enrichmentRefreshedAt ? new Date(profile.enrichmentRefreshedAt).getTime() : 0;
  if (!force && refreshedAt && Date.now() - refreshedAt < ENRICHMENT_TTL_MS) return profile;

  const [whois, dns] = await Promise.all([
    lookupWhois(domain).then((value) => ({ ...value, refreshedAt: new Date() })).catch((error) => ({ error: error instanceof Error ? error.message : 'WHOIS failed', refreshedAt: new Date() })),
    lookupDns(domain).then((value) => ({ ...value, refreshedAt: new Date() })).catch((error) => ({ error: error instanceof Error ? error.message : 'DNS failed', refreshedAt: new Date() }))
  ]);

  return DomainProfile.findOneAndUpdate(
    { deviceId, domain },
    { $set: { whois, dns, enrichmentRefreshedAt: new Date() } },
    { upsert: true, new: true }
  );
}
