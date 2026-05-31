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

export function monitoringRouter({ crawlManager }: { crawlManager: CrawlManager }) {
  const router = Router();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = await withCache(`monitoring:${req.deviceId}`, config.cacheTtlMonitoringMs, async () => {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const [activeCrawls, recentAlerts, domains, failedCrawls, profiles, events, suggestedPages] = await Promise.all([
          CrawlJob.find({ deviceId: req.deviceId, status: { $in: ['queued', 'running', 'paused'] } }).sort({ createdAt: -1 }).limit(25).lean(),
          AlertEvent.find({ deviceId: req.deviceId }).sort({ createdAt: -1 }).limit(100).lean(),
          DomainProfile.find({ deviceId: req.deviceId }).sort({ lastCrawledAt: -1 }).limit(25).lean(),
          CrawlJob.countDocuments({ deviceId: req.deviceId, status: 'failed', updatedAt: { $gte: since } }),
          MonitoringProfile.find({ deviceId: req.deviceId }).sort({ updatedAt: -1 }).limit(100).lean(),
          ChangeEvent.find({ deviceId: req.deviceId }).sort({ detectedAt: -1 }).limit(100).lean(),
          getWorkspaceMonitoringSuggestions(req.deviceId, 15)
        ]);

        const decryptedEvents = events.map((event) => decryptChangeEvent(event));
        const unreadEvents = decryptedEvents.filter((event) => !event.readAt);
        return {
          activeCrawls,
          recentAlerts: dedupeAlerts(recentAlerts).slice(0, 25),
          domains,
          profiles,
          suggestedPages,
          changeFeed: decryptedEvents,
          counts: {
            changesToday: decryptedEvents.filter((event) => new Date(event.detectedAt).getTime() >= since.getTime()).length,
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
      const existingProfile = await MonitoringProfile.findOne({ deviceId: req.deviceId, domain }).lean();
      const shouldRefresh = existingProfile && (existingProfile.monitoredPages || []).length === 0 && (existingProfile.recommendedPages || []).length === 0;
      const profile = shouldRefresh
        ? await refreshRecommendedPages(req.deviceId, domain)
        : existingProfile;
      if (!profile) return res.status(404).json({ message: 'Monitoring profile not found' });
      const [events, domainProfile] = await Promise.all([
        ChangeEvent.find({ deviceId: req.deviceId, domain }).sort({ detectedAt: -1 }).limit(100).lean(),
        DomainProfile.findOne({ deviceId: req.deviceId, domain }).lean()
      ]);
      res.json({ profile, events: events.map((event) => decryptChangeEvent(event)), domain: domainProfile });
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
      const alerts = await AlertEvent.find({ deviceId: req.deviceId })
        .sort({ createdAt: -1 })
        .limit(Math.min(Number(req.query.limit || 25), 100) * 4)
        .lean();
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

function toLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
