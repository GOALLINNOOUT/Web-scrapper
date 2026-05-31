import { MonitoringProfile } from '../models/MonitoringProfile.js';
import { Page } from '../models/Page.js';
import { domainFromUrl, normalizeUrl } from '../utils/url.js';

export type MonitoringType = 'competitive_intelligence' | 'lead_discovery' | 'seo_monitoring' | 'infrastructure_monitoring' | 'custom';

const importantPatterns = [
  { pattern: /pricing|plans|billing/i, label: 'Pricing', score: 95, reason: 'Pricing changes are high-signal competitive intelligence.' },
  { pattern: /careers|jobs|hiring/i, label: 'Careers', score: 92, reason: 'Hiring pages reveal company growth and priorities.' },
  { pattern: /contact|support|sales/i, label: 'Contact', score: 85, reason: 'Contact pages reveal emails and go-to-market channels.' },
  { pattern: /product|solutions|features|platform/i, label: 'Product', score: 84, reason: 'Product pages reveal positioning and launch activity.' },
  { pattern: /blog|news|press|resources/i, label: 'Blog / News', score: 70, reason: 'Content updates reveal announcements and market motion.' },
  { pattern: /about|company|team/i, label: 'About', score: 62, reason: 'Company pages reveal identity, team, and positioning changes.' }
];

export async function createMonitoringProfile(input: {
  deviceId: string;
  domain: string;
  monitoringType?: MonitoringType;
  schedule?: '12h' | 'daily' | 'weekly' | 'monthly';
  sensitivity?: 'low' | 'medium' | 'high';
}) {
  const seedUrl = normalizeUrl(input.domain);
  if (!seedUrl) {
    const error = new Error('Enter a valid domain, for example example.com');
    (error as Error & { status?: number }).status = 400;
    throw error;
  }
  const domain = domainFromUrl(seedUrl);
  const recommendedPages = await recommendPages(input.deviceId, domain, seedUrl);
  return MonitoringProfile.findOneAndUpdate(
    { deviceId: input.deviceId, domain },
    {
      $setOnInsert: {
        deviceId: input.deviceId,
        workspaceId: input.deviceId,
        domain,
        seedUrl,
        monitoredPages: []
      },
      $set: {
        monitoringType: input.monitoringType || 'competitive_intelligence',
        schedule: input.schedule || 'daily',
        sensitivity: input.sensitivity || 'medium',
        enabled: true,
        recommendedPages
      }
    },
    { upsert: true, new: true }
  );
}

export async function refreshRecommendedPages(deviceId: string, domain: string) {
  const profile = await MonitoringProfile.findOne({ deviceId, domain }).lean();
  const recommendedPages = await recommendPages(deviceId, domain, profile?.seedUrl || `https://${domain}/`);
  return MonitoringProfile.findOneAndUpdate(
    { deviceId, domain },
    { $set: { recommendedPages } },
    { new: true }
  );
}

export async function acceptRecommendations(deviceId: string, profileId: string) {
  const profile = await MonitoringProfile.findOne({ _id: profileId, deviceId }).lean();
  if (!profile) return null;
  const pages = (profile.recommendedPages || []).map((page) => ({ ...page, enabled: true }));
  return MonitoringProfile.findOneAndUpdate(
    { _id: profileId, deviceId },
    { $set: { monitoredPages: pages } },
    { new: true }
  );
}

export async function recommendPages(deviceId: string, domain: string, seedUrl: string) {
  const pages = await Page.find({ deviceId, domain, status: 'crawled' }, { url: 1, metadata: 1, score: 1 }).sort({ score: -1 }).limit(200).lean();
  const byUrl = new Map<string, { url: string; label: string; reason: string; score: number; enabled: boolean; signals: string[] }>();
  for (const page of pages) {
    const candidate = scoreMonitoringCandidate(page.url, Number(page.score || 0), page.metadata?.title);
    if (candidate.score < 50) continue;
    byUrl.set(page.url, { ...candidate, url: page.url, enabled: true, signals: ['content', 'metadata', 'emails', 'social', 'tech'] });
  }

  if (byUrl.size === 0) {
    for (const path of ['/pricing', '/careers', '/contact', '/products', '/blog', '/about']) {
      const url = normalizeUrl(path, seedUrl);
      if (!url) continue;
      const candidate = scoreMonitoringCandidate(url, 0);
      byUrl.set(url, { ...candidate, url, enabled: true, signals: ['content', 'metadata', 'emails', 'social', 'tech'] });
    }
  }

  return [...byUrl.values()].sort((left, right) => right.score - left.score).slice(0, 12);
}

export function scoreMonitoringCandidate(url: string, pageScore = 0, title = '') {
  const haystack = `${url} ${title}`;
  for (const item of importantPatterns) {
    if (item.pattern.test(haystack)) {
      return {
        label: item.label,
        reason: item.reason,
        score: Math.max(item.score, Math.min(100, pageScore))
      };
    }
  }
  return {
    label: title || new URL(url).pathname || 'Page',
    reason: 'This page has enough crawl score to be worth watching.',
    score: Math.min(65, Math.max(0, pageScore))
  };
}
