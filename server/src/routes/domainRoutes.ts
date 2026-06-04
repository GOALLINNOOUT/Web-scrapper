import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { DomainProfile } from '../models/DomainProfile.js';
import { enrichDomain, normalizeDomainName, rebuildDomainProfile } from '../intelligence/domain.service.js';
import { domainFromUrl } from '../utils/url.js';
import { config } from '../config/index.js';
import { withCache } from '../utils/cache.js';
import { timeMongoOperation } from '../utils/metrics.js';

const DOMAIN_LIST_PROJECTION = {
  domain: 1,
  totalPages: 1,
  emails: 1,
  socials: 1,
  counts: 1,
  contentCategories: 1,
  avgScore: 1,
  techStack: 1,
  lastCrawledAt: 1,
  whois: 1,
  dns: 1,
  enrichmentRefreshedAt: 1
};

export function domainRouter() {
  const router = Router();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(Number(req.query.limit || 25), 100);
      const profiles = await withCache(`domain:list:${req.deviceId}:${limit}`, config.cacheTtlDomainMs, () => (
        timeMongoOperation('list', 'domainprofiles', () => DomainProfile.find({ deviceId: req.deviceId }, DOMAIN_LIST_PROJECTION)
          .sort({ lastCrawledAt: -1, avgScore: -1 })
          .limit(limit)
          .lean())
      ));
      res.json({ items: profiles });
    } catch (error) {
      next(error);
    }
  });

  router.post('/lookup', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const domain = normalizeDomainLookupInput(String(req.body?.domain || req.body?.url || ''));
      const existing = await timeMongoOperation('lookupExisting', 'domainprofiles', () => DomainProfile.findOne({ deviceId: req.deviceId, domain: { $in: domainAliases(domain) } }, DOMAIN_LIST_PROJECTION).lean());
      if (existing && !req.query.refresh) return res.json(existing);

      const profile = await enrichDomain(req.deviceId, domain, Boolean(req.query.refresh));
      res.json(profile);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:domain', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const domain = normalizeDomainParam(String(req.params.domain));
      const profile = await timeMongoOperation('detail', 'domainprofiles', () => DomainProfile.findOne({ deviceId: req.deviceId, domain: { $in: domainAliases(domain) } }, DOMAIN_LIST_PROJECTION).lean());
      if (!profile) return res.status(404).json({ error: 'NOT_FOUND', message: 'Domain profile not found' });
      res.json(profile);
    } catch (error) {
      next(error);
    }
  });

  router.post('/:domain/enrich', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const domain = normalizeDomainParam(String(req.params.domain));
      const profile = await enrichDomain(req.deviceId, domain, true);
      res.json(profile);
    } catch (error) {
      next(error);
    }
  });

  router.post('/:domain/rebuild', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const domain = normalizeDomainParam(String(req.params.domain));
      const profile = await rebuildDomainProfile(req.deviceId, domain);
      res.json(profile);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function normalizeDomainParam(value: string) {
  const decoded = decodeURIComponent(value);
  const domain = normalizeDomainName(decoded.includes('://') ? domainFromUrl(decoded) : decoded);
  if (!domain) {
    const error = new Error('A valid domain is required');
    (error as Error & { status?: number }).status = 400;
    throw error;
  }
  return domain;
}

function normalizeDomainLookupInput(value: string) {
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, '').replace(/,/g, '.');
  if (!trimmed) return invalidDomain();

  let parsed: URL;
  try {
    parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return invalidDomain();
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) return invalidDomain();
  const path = parsed.pathname.replace(/\/+$/, '');
  if (path && path !== '/') return invalidDomain('Enter only a domain, not a page path.');

  const hostname = normalizeDomainName(parsed.hostname);
  if (!isValidDomain(hostname)) return invalidDomain();
  return hostname;
}

function domainAliases(domain: string) {
  const canonical = normalizeDomainName(domain);
  return canonical ? [canonical, `www.${canonical}`] : [];
}

function isValidDomain(domain: string) {
  if (domain.length < 4 || domain.length > 253) return false;
  if (!domain.includes('.')) return false;
  if (domain.includes('..')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(domain)) return false;
  return domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    && /^[a-z]{2,63}$/.test(domain.split('.').at(-1) || '');
}

function invalidDomain(message = 'Enter a valid domain, for example example.com.'): never {
  const error = new Error(message);
  (error as Error & { status?: number }).status = 400;
  throw error;
}
