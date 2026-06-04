import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { AlertEvent } from '../models/AlertEvent.js';
import { ChangeEvent } from '../models/ChangeEvent.js';
import { CrawlJob } from '../models/CrawlJob.js';
import { DomainProfile } from '../models/DomainProfile.js';
import { MonitoringProfile } from '../models/MonitoringProfile.js';
import type { CrawlManager } from '../crawler/CrawlManager.js';
import { config } from '../config/index.js';
import { withCache } from '../utils/cache.js';
import {
  acceptRecommendations,
  acceptWorkspaceSuggestion,
  createMonitoringProfile,
  getWorkspaceMonitoringSuggestions,
  refreshRecommendedPages,
  type MonitoringType
} from '../services/monitoringProfileService.js';
import { invalidateWorkspaceReads } from '../services/cacheInvalidation.js';
import { decryptChangeEvent } from '../services/changePayloadCrypto.js';
import { getWorkspaceSettings } from '../services/workspaceSettingsService.js';
import { timeMongoOperation } from '../utils/metrics.js';

const MONITORING_PROFILE_PROJECTION = {
  deviceId: 1,
  domain: 1,
  seedUrl: 1,
  monitoringType: 1,
  monitoredPages: 1,
  recommendedPages: 1,
  schedule: 1,
  sensitivity: 1,
  enabled: 1,
  lastCheckedAt: 1,
  lastChangeAt: 1,
  discoveryCrawlId: 1,
  createdAt: 1,
  updatedAt: 1
};

const CHANGE_EVENT_PROJECTION = {
  deviceId: 1,
  domain: 1,
  url: 1,
  eventType: 1,
  oldValue: 1,
  newValue: 1,
  diff: 1,
  severity: 1,
  reason: 1,
  crawlId: 1,
  readAt: 1,
  detectedAt: 1
};

const ALERT_EVENT_PROJECTION = {
  deviceId: 1,
  type: 1,
  severity: 1,
  domain: 1,
  crawlId: 1,
  pageUrl: 1,
  message: 1,
  metadata: 1,
  readAt: 1,
  createdAt: 1
};

const DOMAIN_PROFILE_COMPACT_PROJECTION = {
  domain: 1,
  totalPages: 1,
  counts: 1,
  avgScore: 1,
  lastCrawledAt: 1,
  emails: 1,
  socials: 1,
  techStack: 1,
  dns: 1,
  whois: 1
};

export function monitoringRouter({ crawlManager }: { crawlManager: CrawlManager }) {
  const router = Router();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const timeZone = sanitizeTimeZone(req.query.timeZone);
      const payload = await withCache(`monitoring:${req.deviceId}:${timeZone}`, config.cacheTtlMonitoringMs, async () => {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const [activeCrawls, recentAlerts, domains, failedCrawls, profiles, events, suggestedPages] = await Promise.all([
          timeMongoOperation('monitoring.activeCrawls', 'crawljobs', () => CrawlJob.find({ deviceId: req.deviceId, status: { $in: ['queued', 'running', 'paused'] } }, { deviceId: 1, seedUrl: 1, status: 1, config: 1, pagesCrawled: 1, emailsFound: 1, socialLinksFound: 1, requestedPause: 1, requestedStop: 1, error: 1, createdAt: 1, updatedAt: 1 }).sort({ createdAt: -1 }).limit(25).lean()),
          timeMongoOperation('monitoring.alerts', 'alertevents', () => AlertEvent.find({ deviceId: req.deviceId }, ALERT_EVENT_PROJECTION).sort({ createdAt: -1 }).limit(100).lean()),
          timeMongoOperation('monitoring.domains', 'domainprofiles', () => DomainProfile.find({ deviceId: req.deviceId }, DOMAIN_PROFILE_COMPACT_PROJECTION).sort({ lastCrawledAt: -1 }).limit(25).lean()),
          timeMongoOperation('monitoring.failedCrawls', 'crawljobs', () => CrawlJob.countDocuments({ deviceId: req.deviceId, status: 'failed', updatedAt: { $gte: since } })),
          timeMongoOperation('monitoring.profiles', 'monitoringprofiles', () => MonitoringProfile.find({ deviceId: req.deviceId }, MONITORING_PROFILE_PROJECTION).sort({ updatedAt: -1 }).limit(100).lean()),
          timeMongoOperation('monitoring.events', 'changeevents', () => ChangeEvent.find({ deviceId: req.deviceId }, CHANGE_EVENT_PROJECTION).sort({ detectedAt: -1 }).limit(100).lean()),
          getWorkspaceMonitoringSuggestions(req.deviceId, 15)
        ]);

        const decryptedEvents = events.map((event) => decryptChangeEvent(event)).filter((event) => isMonitoredEvent(event, profiles));
        const unreadEvents = decryptedEvents.filter((event) => !event.readAt);
        const todayKey = toLocalDateKey(new Date(), timeZone);
        return {
          activeCrawls,
          recentAlerts: dedupeAlerts(recentAlerts).slice(0, 25),
          domains,
          profiles,
          suggestedPages,
          changeFeed: decryptedEvents,
          counts: {
            changesToday: decryptedEvents.filter((event) => toLocalDateKey(new Date(event.detectedAt), timeZone) === todayKey).length,
            newPages: decryptedEvents.filter((event) => event.eventType === 'new_page').length,
            newEmails: decryptedEvents.filter((event) => event.eventType === 'new_email').length,
            dnsChanges: decryptedEvents.filter((event) => event.eventType === 'dns_changed').length,
            unread: unreadEvents.length
          },
          health: {
            activeCrawls: activeCrawls.length,
            monitoredDomains: profiles.length || domains.length,
            failedCrawls24h: failedCrawls
          }
        };
      });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.post('/profiles', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profile = await createMonitoringProfile({
        deviceId: req.deviceId,
        domain: String(req.body?.domain || ''),
        monitoringType: req.body?.monitoringType as MonitoringType | undefined,
        schedule: req.body?.schedule,
        sensitivity: req.body?.sensitivity
      });

      const settings = await getWorkspaceSettings(req.deviceId).catch(() => null);
      const crawling = settings?.crawling as { maxPages?: number; defaultDepth?: number; respectRobots?: boolean } | undefined;
      const job = await crawlManager.createJob({
        seedUrl: profile.seedUrl,
        maxPages: Math.min(crawling?.maxPages || 100, 500),
        maxDepth: crawling?.defaultDepth || 2,
        respectRobots: crawling?.respectRobots || false,
        sameDomainOnly: true,
        schedule: 'none',
        discovery: { sitemap: true, renderJavaScript: true, renderWhenStaticLinksBelow: 20, includeMetaLinks: true },
        extract: { links: true, emails: true, metadata: true, social: true, content: true }
      }, req.deviceId);
      profile.discoveryCrawlId = job._id;
      await profile.save();
      await invalidateWorkspaceReads(req.deviceId).catch(() => undefined);
      res.status(201).json({ profile, discoveryCrawl: job });
    } catch (error) {
      next(error);
    }
  });

  router.post('/suggestions/accept', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profile = await acceptWorkspaceSuggestion(
        req.deviceId,
        String(req.body?.url || ''),
        req.body?.monitoringType as MonitoringType | undefined
      );
      if (!profile) return res.status(404).json({ message: 'Suggested page not found' });
      await invalidateWorkspaceReads(req.deviceId).catch(() => undefined);
      res.status(201).json(profile);
    } catch (error) {
      next(error);
    }
  });

  router.get('/profiles/:domain', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const domain = String(req.params.domain || '').toLowerCase();
      const existingProfile = await timeMongoOperation('profile.detail', 'monitoringprofiles', () => MonitoringProfile.findOne({ deviceId: req.deviceId, domain }, MONITORING_PROFILE_PROJECTION).lean());
      const shouldRefresh = existingProfile && (existingProfile.monitoredPages || []).length === 0 && (existingProfile.recommendedPages || []).length === 0;
      const profile = shouldRefresh
        ? await refreshRecommendedPages(req.deviceId, domain)
        : existingProfile;
      if (!profile) return res.status(404).json({ message: 'Monitoring profile not found' });
      const [events, domainProfile] = await Promise.all([
        timeMongoOperation('profile.events', 'changeevents', () => ChangeEvent.find({ deviceId: req.deviceId, domain }, CHANGE_EVENT_PROJECTION).sort({ detectedAt: -1 }).limit(100).lean()),
        timeMongoOperation('profile.domain', 'domainprofiles', () => DomainProfile.findOne({ deviceId: req.deviceId, domain }, DOMAIN_PROFILE_COMPACT_PROJECTION).lean())
      ]);
      const filteredEvents = events.map((event) => decryptChangeEvent(event)).filter((event) => isMonitoredEvent(event, profile ? [profile] : []));
      res.json({ profile, events: filteredEvents, domain: domainProfile });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/profiles/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const allowed = ['monitoredPages', 'recommendedPages', 'schedule', 'sensitivity', 'enabled'];
      const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.includes(key)));
      const profile = await MonitoringProfile.findOneAndUpdate(
        { _id: req.params.id, deviceId: req.deviceId },
        { $set: patch },
        { new: true }
      );
      if (!profile) return res.status(404).json({ message: 'Monitoring profile not found' });
      await invalidateWorkspaceReads(req.deviceId).catch(() => undefined);
      res.json(profile);
    } catch (error) {
      next(error);
    }
  });

  router.post('/profiles/:id/accept-recommendations', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profile = await acceptRecommendations(req.deviceId, String(req.params.id));
      if (!profile) return res.status(404).json({ message: 'Monitoring profile not found' });
      await invalidateWorkspaceReads(req.deviceId).catch(() => undefined);
      res.json(profile);
    } catch (error) {
      next(error);
    }
  });

  router.patch('/events/:id/read', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const event = await ChangeEvent.findOneAndUpdate(
        { _id: req.params.id, deviceId: req.deviceId },
        { $set: { readAt: new Date() } },
        { new: true }
      );
      if (!event) return res.status(404).json({ message: 'Change event not found' });
      await invalidateWorkspaceReads(req.deviceId).catch(() => undefined);
      res.json(decryptChangeEvent(event.toObject()));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function alertsRouter() {
  const router = Router();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const alerts = await timeMongoOperation('alerts.list', 'alertevents', () => AlertEvent.find({ deviceId: req.deviceId }, ALERT_EVENT_PROJECTION)
        .sort({ createdAt: -1 })
        .limit(Math.min(Number(req.query.limit || 25), 100) * 4)
        .lean());
      res.json({ items: dedupeAlerts(alerts).slice(0, Math.min(Number(req.query.limit || 25), 100)) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function dedupeAlerts<T extends { type?: string; createdAt?: Date; domain?: string | null; message?: string; metadata?: unknown }>(alerts: T[]) {
  const seen = new Set<string>();
  const output: T[] = [];

  for (const alert of alerts) {
    const keys = alertDedupeKeys(alert);
    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    output.push(alert);
  }

  return output;
}

function alertDedupeKeys(alert: { type?: string; createdAt?: Date; domain?: string | null; message?: string; metadata?: unknown }) {
  const day = toLocalDateKey(alert.createdAt ? new Date(alert.createdAt) : new Date());
  const metadata = (alert.metadata || {}) as Record<string, unknown>;
  const emails = Array.isArray(metadata.emails) ? metadata.emails.map(String) : [];
  if (alert.type === 'new_email' && emails.length > 0) {
    return emails.map((email) => `email:${day}:${email.toLowerCase()}`);
  }

  const socials = extractSocialValues(metadata);
  if (socials.length > 0) {
    return socials.map((social) => `social:${day}:${social.toLowerCase()}`);
  }

  return [`alert:${alert.type || ''}:${day}:${alert.domain || ''}:${alert.message || ''}`];
}

function extractSocialValues(metadata: Record<string, unknown>) {
  return [metadata.social, metadata.socials, metadata.profiles].flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    if (Array.isArray(candidate)) return candidate.map(String);
    return Object.values(candidate as Record<string, unknown>).flatMap((value) => {
      if (Array.isArray(value)) return value.map(String);
      if (typeof value === 'string') return [value];
      return [];
    });
  });
}

function toLocalDateKey(date: Date, timeZone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value || String(date.getUTCFullYear());
  const month = parts.find((part) => part.type === 'month')?.value || String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = parts.find((part) => part.type === 'day')?.value || String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sanitizeTimeZone(value: unknown) {
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return 'UTC';
  }
}

function isMonitoredEvent(
  event: { domain?: string; url?: string },
  profiles: Array<{ domain?: string; seedUrl?: string; enabled?: boolean; monitoredPages?: Array<{ url?: string; enabled?: boolean }> }>
) {
  const eventDomain = String(event.domain || '').toLowerCase().replace(/^www\./, '');
  const eventUrl = normalizeUrlForCompare(event.url || '');
  if (!eventDomain || !eventUrl) return false;

  return profiles.some((profile) => {
    if (profile.enabled === false) return false;
    const profileDomain = String(profile.domain || '').toLowerCase().replace(/^www\./, '');
    if (profileDomain !== eventDomain) return false;

    const pages = (profile.monitoredPages || []).filter((page) => page.enabled !== false);
    if (pages.length === 0) return eventUrl === normalizeUrlForCompare(profile.seedUrl || '');
    return pages.some((page) => eventUrl === normalizeUrlForCompare(page.url || ''));
  });
}

function normalizeUrlForCompare(value: string) {
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString();
  } catch {
    return value;
  }
}
