import type { Types } from 'mongoose';
import { CrawlSummary } from '../models/CrawlSummary.js';
import { Page } from '../models/Page.js';
import { CrawlJob } from '../models/CrawlJob.js';
import { timeMongoOperation } from '../utils/metrics.js';

interface SummaryPageInput {
  deviceId: string;
  crawlId: string;
  pageUrl: string;
  emails: string[];
  social: Record<string, string[] | undefined>;
  techStack: string[];
}

export async function updateCrawlSummaryForPage(input: SummaryPageInput) {
  const emails = [...new Set(input.emails.map((email) => email.toLowerCase()).filter(Boolean))];
  const socialOccurrences = Object.entries(input.social || {}).flatMap(([platform, links]) => (
    (links || []).map((value) => ({ platform, value: String(value), pageUrl: input.pageUrl }))
  ));
  const socialLinks = new Map<string, Set<string>>();
  for (const item of socialOccurrences) {
    if (!socialLinks.has(item.platform)) socialLinks.set(item.platform, new Set());
    socialLinks.get(item.platform)?.add(item.value);
  }

  const existing = await timeMongoOperation('crawlSummary.pageExisting', 'crawlsummaries', () => CrawlSummary.findOne({ deviceId: input.deviceId, crawlId: input.crawlId }).lean());
  const groups = new Map<string, Set<string>>();
  for (const group of existing?.socials || []) {
    groups.set(String(group.platform), new Set((group.links || []).map(String)));
  }
  for (const [platform, links] of socialLinks.entries()) {
    if (!groups.has(platform)) groups.set(platform, new Set());
    for (const link of links) groups.get(platform)?.add(link);
  }
  const nextSocials = [...groups.entries()]
    .map(([platform, links]) => ({ platform, links: [...links].sort() }))
    .filter((group) => group.links.length > 0)
    .sort((a, b) => a.platform.localeCompare(b.platform));

  const nextEmails = [...new Set([...(existing?.emails || []), ...emails])].sort();
  const nextTech = [...new Set([...(existing?.techStack || []), ...(input.techStack || [])])].sort();

  await timeMongoOperation('crawlSummary.pageUpdate', 'crawlsummaries', () => CrawlSummary.findOneAndUpdate(
    { deviceId: input.deviceId, crawlId: input.crawlId },
    {
      $set: {
        emails: nextEmails,
        socials: nextSocials,
        techStack: nextTech,
        'counts.uniqueEmails': nextEmails.length,
        'counts.uniqueSocialProfiles': nextSocials.reduce((total, group) => total + group.links.length, 0),
        'counts.uniqueTech': nextTech.length
      },
      $inc: {
        'counts.loadedPages': 1,
        'counts.rawEmailOccurrences': input.emails.length,
        'counts.rawSocialOccurrences': socialOccurrences.length
      },
      $addToSet: {
        emailOccurrences: { $each: emails.map((value) => ({ value, pageUrl: input.pageUrl })) },
        socialOccurrences: { $each: socialOccurrences }
      }
    },
    { upsert: true, new: true }
  ));
}

export async function rebuildCrawlSummary(deviceId: string, crawlId: string | Types.ObjectId) {
  const [job, pages] = await Promise.all([
    timeMongoOperation('crawlSummary.job', 'crawljobs', () => CrawlJob.findOne({ _id: crawlId, deviceId }).lean()),
    timeMongoOperation('crawlSummary.pages', 'pages', () => Page.find(
      { deviceId, crawlId, status: 'crawled' },
      { url: 1, emails: 1, social: 1, techStack: 1 }
    ).lean())
  ]);

  const emails = [...new Set(pages.flatMap((page) => page.emails || []).map((email) => email.toLowerCase()))].sort();
  const emailOccurrences = pages.flatMap((page) => (page.emails || []).map((email) => ({
    value: email.toLowerCase(),
    pageUrl: page.url
  })));
  const socialMap = new Map<string, Set<string>>();
  const socialOccurrences = pages.flatMap((page) => Object.entries(page.social || {}).flatMap(([platform, links]) => (
    (links || []).map((value) => {
      if (!socialMap.has(platform)) socialMap.set(platform, new Set());
      socialMap.get(platform)?.add(String(value));
      return { platform, value: String(value), pageUrl: page.url };
    })
  )));
  const socials = [...socialMap.entries()]
    .map(([platform, values]) => ({ platform, links: [...values].sort() }))
    .filter((group) => group.links.length > 0)
    .sort((a, b) => a.platform.localeCompare(b.platform));
  const techStack = [...new Set(pages.flatMap((page) => page.techStack || []))].sort();

  return timeMongoOperation('crawlSummary.rebuildUpdate', 'crawlsummaries', () => CrawlSummary.findOneAndUpdate(
    { deviceId, crawlId },
    {
      $set: {
        deviceId,
        crawlId,
        emails,
        emailOccurrences,
        socials,
        socialOccurrences,
        techStack,
        counts: {
          uniqueEmails: emails.length,
          uniqueSocialProfiles: socials.reduce((total, group) => total + group.links.length, 0),
          uniqueTech: techStack.length,
          loadedPages: pages.length,
          rawEmailOccurrences: job?.emailsFound || emailOccurrences.length,
          rawSocialOccurrences: job?.socialLinksFound || socialOccurrences.length
        }
      }
    },
    { upsert: true, new: true }
  ).lean());
}
