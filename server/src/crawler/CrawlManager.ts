import * as cheerio from 'cheerio';
import { CrawlJob } from '../models/CrawlJob.js';
import { Page } from '../models/Page.js';
import { fetchPage } from './fetchPage.js';
import { renderPageSnapshot } from './renderPage.js';
import { discoverSitemapUrls } from './sitemap.js';
import { isAllowedByRobots } from './robots.js';
import { normalizeCrawlConfig, withCrawlConfigDefaults, type RawCrawlConfig } from './config.js';
import type { QueueBundle } from '../queue/queues.js';
import { extractLinks } from '../extractors/links.js';
import { extractEmails } from '../extractors/emails.js';
import { extractMetadata } from '../extractors/metadata.js';
import { countSocialLinks, emptySocial, extractSocialLinks } from '../extractors/social.js';
import { detectTechStack } from '../extractors/techStack.js';
import { extractContent } from '../extractors/content.js';
import { classifyPage } from '../intelligence/classifier.js';
import { scorePage } from '../intelligence/scorer.js';
import { hashContent } from '../utils/hash.js';
import { domainFromUrl, isLikelyPageUrl, isSameDomain, assertPublicHttpUrl } from '../utils/url.js';
import type { CrawlConfig, Metadata, QueueItem, SocialLinks } from '../types.js';
import { AlertEvent } from '../models/AlertEvent.js';
import { retentionDate } from '../utils/retention.js';
import { enrichDomain, rebuildDomainProfile } from '../intelligence/domain.service.js';
import { logger } from '../utils/logger.js';
import { createDailyEmailAlert } from '../services/alertService.js';
import { updateCrawlSummaryForPage, rebuildCrawlSummary } from '../services/crawlSummaryService.js';
import { invalidateCrawlReads, invalidateDomainReads, invalidateWorkspaceReads } from '../services/cacheInvalidation.js';
import { publishLiveEvent } from '../services/liveEvents.js';

function sevenDaysFromNow() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

interface RunState {
  stop: boolean;
  pause: boolean;
  controllers: Set<AbortController>;
}

interface CrawlPageInput {
  deviceId: string;
  crawlId: string;
  item: QueueItem;
  config: CrawlConfig;
  signal: AbortSignal;
}

interface CrawlPageResult {
  url: string;
  depth: number;
  links: string[];
  pageId: string;
  emailCount: number;
  socialCount: number;
  failed: boolean;
  error?: string;
}

export class CrawlManager {
  private running: Map<string, RunState>;
  private queues?: QueueBundle;

  constructor(queues?: QueueBundle) {
    this.running = new Map();
    this.queues = queues;
  }

  async createJob(rawConfig: RawCrawlConfig, deviceId: string) {
    const activeJobs = await CrawlJob.countDocuments({
      deviceId,
      status: { $in: ['queued', 'running', 'paused'] }
    });
    const maxActiveJobs = clampEnvNumber(process.env.MAX_ACTIVE_CRAWLS_PER_DEVICE, 1, 10, 2);
    if (activeJobs >= maxActiveJobs) {
      const error = new Error(`Only ${maxActiveJobs} active crawls are allowed at once`);
      (error as Error & { status?: number }).status = 429;
      throw error;
    }

    const config = normalizeCrawlConfig(rawConfig);
    const job = await CrawlJob.create({
      deviceId,
      seedUrl: config.seedUrl,
      config,
      status: 'queued',
      expiresAt: retentionDate()
    });
    await invalidateWorkspaceReads(deviceId).catch(() => undefined);

    if (this.queues) {
      const queueJob = await this.queues.crawlJobs.add('run-crawl', { crawlId: job._id.toString(), deviceId }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200
      });
      job.queueJobId = queueJob.id || null;
      await job.save();
    } else {
      this.runJob(job._id.toString()).catch((error) => {
        logger.error(error, `Crawl ${job._id} crashed`);
      });
    }

    await publishLiveEvent({
      type: 'crawl.updated',
      deviceId,
      crawlId: job._id.toString(),
      data: { job: toLiveJob(job) }
    }).catch(() => undefined);

    return job;
  }

  async stopJob(id: string, deviceId: string) {
    const job = await CrawlJob.findOneAndUpdate(
      { _id: id, deviceId },
      {
        requestedStop: true,
        requestedPause: false,
        status: 'stopped',
        completedAt: new Date()
      },
      { new: true }
    );
    if (job) {
      await this.removeQueuedPageJobs(id, deviceId);
      const running = this.running.get(id);
      if (running) {
        running.stop = true;
        for (const controller of running.controllers) {
          controller.abort();
        }
      }
    }
    await invalidateCrawlReads(deviceId, id).catch(() => undefined);
    return job;
  }

  async pauseJob(id: string, deviceId: string) {
    const job = await CrawlJob.findOneAndUpdate({ _id: id, deviceId }, {
      requestedPause: true,
      status: 'paused'
    }, { new: true });
    if (job) {
      const running = this.running.get(id);
      if (running) running.pause = true;
    }
    await invalidateCrawlReads(deviceId, id).catch(() => undefined);
    return job;
  }

  async continueJob(id: string, deviceId: string) {
    const job = await CrawlJob.findOneAndUpdate({ _id: id, deviceId }, {
      requestedPause: false,
      status: 'running'
    }, { new: true });
    if (job) {
      const running = this.running.get(id);
      if (running) running.pause = false;
    }
    await invalidateCrawlReads(deviceId, id).catch(() => undefined);
    return job;
  }

  private async removeQueuedPageJobs(crawlId: string, deviceId: string) {
    if (!this.queues) return;
    const queues = [this.queues.crawlJobs, this.queues.crawlPagesHigh, this.queues.crawlPages, this.queues.crawlPagesLow];
    await Promise.all(queues.map(async (queue) => {
      let start = 0;
      const pageSize = 500;
      while (true) {
        const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized', 'paused'], start, start + pageSize - 1);
        if (jobs.length === 0) break;
        await Promise.all(jobs.map(async (job) => {
          const data = job.data as { crawlId?: string; deviceId?: string };
          if (String(data?.crawlId || '') === crawlId && String(data?.deviceId || '') === deviceId) {
            await job.remove().catch(() => undefined);
          }
        }));
        if (jobs.length < pageSize) break;
        start += pageSize;
      }
    }));
  }

  async retryJob(id: string, deviceId: string) {
    const existing = await CrawlJob.findOne({ _id: id, deviceId }).lean();
    if (!existing) return null;
    return this.createJob(existing.config as RawCrawlConfig, deviceId);
  }

  async runJob(id: string) {
    if (this.running.has(id)) return;

    const state: RunState = { stop: false, pause: false, controllers: new Set() };
    this.running.set(id, state);

    try {
      const job = await CrawlJob.findByIdAndUpdate(
        id,
        { status: 'running', startedAt: new Date(), error: null },
        { new: true }
      );
      if (!job) return;

      const jobConfigValue = job.config as Partial<CrawlConfig> & { toObject?: () => Partial<CrawlConfig> };
      const rawJobConfig = typeof jobConfigValue.toObject === 'function'
        ? jobConfigValue.toObject()
        : jobConfigValue;
      const config = withCrawlConfigDefaults({
        ...rawJobConfig,
        seedUrl: rawJobConfig.seedUrl || job.seedUrl
      } as CrawlConfig);
      const deviceId = job.deviceId;
      const queue: QueueItem[] = [{ url: config.seedUrl, depth: 0, parentUrl: null, discoveredFrom: null }];
      let queueIndex = 0;
      const visited = new Set<string>();
      const queued = new Set([config.seedUrl]);
      let successfulPages = 0;

      if (config.extract.links && config.discovery.sitemap && config.maxDepth > 0) {
        const sitemapLinks = await discoverSitemapUrls(config.seedUrl, Math.min(config.maxPages, 250)).catch(() => []);
        for (const link of sitemapLinks) {
          if (visited.has(link) || queued.has(link)) continue;
          if (!isLikelyPageUrl(link)) continue;
          if (config.sameDomainOnly && !isSameDomain(link, config.seedUrl)) continue;
          queued.add(link);
          queue.push({
            url: link,
            depth: 1,
            parentUrl: config.seedUrl,
            discoveredFrom: null
          });
        }
      }

      while (queueIndex < queue.length && visited.size < config.maxPages) {
        while (state.pause && !state.stop) {
          await delay(500);
        }

        if (state.stop) break;

        const batch: QueueItem[] = [];
        while (batch.length < config.concurrency && queueIndex < queue.length && visited.size + batch.length < config.maxPages) {
          const item = queue[queueIndex];
          queueIndex += 1;
          if (!item || visited.has(item.url)) continue;
          batch.push(item);
        }

        if (batch.length === 0) continue;

        const results = await Promise.all(batch.map(async (item) => {
          const controller = new AbortController();
          state.controllers.add(controller);
          if (state.stop) controller.abort();

          try {
            return await this.crawlPage({
              deviceId,
              crawlId: id,
              item,
              config,
              signal: controller.signal
            });
          } finally {
            state.controllers.delete(controller);
          }
        }));

        let pagesCrawled = 0;
        let emailsFound = 0;
        let socialLinksFound = 0;

        for (const result of results) {
          if (!result) continue;
          if (state.stop) break;

          if (result.failed && result.depth === 0) {
            throw new Error(toReachabilityMessage(result.url, result.error));
          }

          visited.add(result.url);
          if (result.failed) continue;

          pagesCrawled += 1;
          emailsFound += result.emailCount;
          socialLinksFound += result.socialCount;

          if (result.depth < config.maxDepth && config.extract.links) {
            for (const link of result.links) {
              if (visited.has(link) || queued.has(link)) continue;
              if (!isLikelyPageUrl(link)) continue;
              if (config.sameDomainOnly && !isSameDomain(link, config.seedUrl)) continue;
              queued.add(link);
              queue.push({
                url: link,
                depth: result.depth + 1,
                parentUrl: result.url,
                discoveredFrom: result.pageId
              });
            }
          }
        }

        if (pagesCrawled > 0) {
          successfulPages += pagesCrawled;
          await CrawlJob.findByIdAndUpdate(id, {
            $inc: {
              pagesCrawled,
              emailsFound,
              socialLinksFound
            }
          });
        }
      }

      if (!state.stop && successfulPages === 0) {
        throw new Error(toReachabilityMessage(config.seedUrl));
      }

      const finalJob = await CrawlJob.findByIdAndUpdate(id, {
        status: state.stop ? 'stopped' : 'completed',
        requestedPause: false,
        completedAt: new Date(),
        durationMs: Date.now() - new Date(job.startedAt || Date.now()).getTime()
      }, { new: true }).lean();
      if (finalJob) {
        await publishLiveEvent({
          type: 'crawl.updated',
          deviceId,
          crawlId: id,
          data: {
            job: {
              status: finalJob.status,
              pagesCrawled: finalJob.pagesCrawled || 0,
              emailsFound: finalJob.emailsFound || 0,
              socialLinksFound: finalJob.socialLinksFound || 0
            }
          }
        }).catch(() => undefined);
      }
      if (!state.stop) {
        const domain = domainFromUrl(config.seedUrl);
        await rebuildCrawlSummary(deviceId, id).catch(() => undefined);
        await rebuildDomainProfile(deviceId, domain).catch(() => undefined);
        await invalidateDomainReads(deviceId).catch(() => undefined);
        await AlertEvent.create({
          deviceId,
          type: 'new_domain',
          domain,
          crawlId: id,
          message: `Domain profile updated for ${domain}`
        }).catch(() => undefined);

        if (this.queues) {
          await this.queues.domainEnrichment.add('enrich-domain', { deviceId, domain }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 200
          });
        } else {
          await enrichDomain(deviceId, domain).catch(() => undefined);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown crawl failure';
      await CrawlJob.findByIdAndUpdate(id, {
        status: 'failed',
        error: message,
        deadLetterReason: message,
        completedAt: new Date()
      });
      await AlertEvent.create({
        deviceId: (await CrawlJob.findById(id).lean())?.deviceId || 'unknown',
        type: 'crawl_failed',
        crawlId: id,
        message
      }).catch(() => undefined);
    } finally {
      this.running.delete(id);
    }
  }

  async crawlPage({ deviceId, crawlId, item, config, signal }: CrawlPageInput): Promise<CrawlPageResult | null> {
    try {
      assertPublicHttpUrl(item.url);
      if (!(await isAllowedByRobots(item.url))) {
        const message = 'robots.txt disallows this URL.';
        const page = await Page.findOneAndUpdate(
          { deviceId, crawlId, url: item.url },
          {
            $set: {
              deviceId,
              workspaceId: deviceId,
              crawlId,
              url: item.url,
              domain: domainFromUrl(item.url),
              depth: item.depth,
              parentUrl: item.parentUrl || null,
              parentPageId: item.discoveredFrom || null,
              discoveredFrom: item.parentUrl || null,
              metadata: { title: `Skipped: ${message}` },
              links: [],
              emails: [],
              social: emptySocial(),
              techStack: [],
              content: { text: '', headings: [], paragraphs: [], wordCount: 0 },
              classification: { pageType: 'skipped', confidence: 1 },
              score: 0,
              searchText: `${item.url} ${domainFromUrl(item.url)} skipped ${message}`,
              crawledAt: new Date(),
              expiresAt: retentionDate(),
              contentHash: hashContent(`robots:${item.url}`),
              status: 'skipped'
            }
          },
          { upsert: true, new: true }
        );

        return {
          url: item.url,
          depth: item.depth,
          links: [],
          pageId: page._id.toString(),
          emailCount: 0,
          socialCount: 0,
          failed: true,
          error: message
        };
      }

      const html = await fetchPage(item.url, 2, signal);
      let extractionHtml = html;
      let $ = cheerio.load(extractionHtml);
      let links = config.extract.links ? extractLinks($, item.url, { includeMetaLinks: config.discovery.includeMetaLinks }) : [];
      let runtimeTechStack: string[] = [];

      if (
        config.discovery.renderJavaScript
        && (
          !config.extract.links
          || links.length < config.discovery.renderWhenStaticLinksBelow
        )
      ) {
        const renderedSnapshot = await renderPageSnapshot(item.url, signal);
        if (renderedSnapshot) {
          runtimeTechStack = renderedSnapshot.techStack;
          const rendered$ = cheerio.load(renderedSnapshot.html);
          const renderedLinks = extractLinks(rendered$, item.url, { includeMetaLinks: config.discovery.includeMetaLinks });
          links = [...new Set([...links, ...renderedLinks])];
          extractionHtml = renderedSnapshot.html;
          $ = rendered$;
        }
      }

      const emails = config.extract.emails ? extractEmails(extractionHtml) : [];
      const metadata = config.extract.metadata ? extractMetadata($, item.url) : {};
      const social = config.extract.social ? extractSocialLinks(links) : emptySocial();
      const staticTechStack = detectTechStack($, {}, extractionHtml);
      const techStack = [...new Set([...staticTechStack, ...runtimeTechStack])].sort();
      const content = config.extract.content !== false ? extractContent($) : { text: '', headings: [], paragraphs: [], wordCount: 0 };
      const classification = classifyPage(item.url, metadata.title);
      const score = scorePage({ metadata, content, emails, social, classification });
      const parentPageId = item.discoveredFrom || null;

      const page = await Page.findOneAndUpdate(
        { deviceId, crawlId, url: item.url },
        {
          $set: {
            deviceId,
            workspaceId: deviceId,
            crawlId,
            url: item.url,
            domain: domainFromUrl(item.url),
            depth: item.depth,
            parentUrl: item.parentUrl || null,
            parentPageId,
            discoveredFrom: item.parentUrl || null,
            metadata,
            links,
            emails,
            social,
            techStack,
            content,
            classification,
            score,
            searchText: buildSearchText({ url: item.url, domain: domainFromUrl(item.url), metadata, emails, links, social, contentText: content.text, classification: classification.pageType }),
            crawledAt: new Date(),
            expiresAt: retentionDate(),
            contentHash: hashContent(extractionHtml),
            status: 'crawled'
          }
        },
        { upsert: true, new: true }
      );

      if (emails.length > 0) {
        await createDailyEmailAlert({
          deviceId,
          domain: domainFromUrl(item.url),
          crawlId,
          pageUrl: item.url,
          emails
        }).catch(() => undefined);
      }

      await updateCrawlSummaryForPage({
        deviceId,
        crawlId,
        pageUrl: item.url,
        emails,
        social: social as unknown as Record<string, string[] | undefined>,
        techStack
      }).catch(() => undefined);
      await invalidateCrawlReads(deviceId, crawlId, { publish: false }).catch(() => undefined);
      await publishLiveEvent({
        type: 'crawl.page',
        deviceId,
        crawlId,
        data: {
          page: toLivePage(page),
          job: {
            pagesCrawledDelta: 1,
            emailsFoundDelta: emails.length,
            socialLinksFoundDelta: countSocialLinks(social)
          }
        }
      }).catch(() => undefined);

      return {
        url: item.url,
        depth: item.depth,
        links,
        pageId: page._id.toString(),
        emailCount: emails.length,
        socialCount: countSocialLinks(social),
        failed: false
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown fetch failure';
      const page = await Page.findOneAndUpdate(
        { deviceId, crawlId, url: item.url },
        {
          $set: {
            deviceId,
            workspaceId: deviceId,
            crawlId,
            url: item.url,
            domain: domainFromUrl(item.url),
            depth: item.depth,
            parentUrl: item.parentUrl || null,
            parentPageId: item.discoveredFrom || null,
            discoveredFrom: item.parentUrl || null,
            metadata: { title: `Fetch failed: ${message}` },
            links: [],
            emails: [],
            social: emptySocial(),
            techStack: [],
            content: { text: '', headings: [], paragraphs: [], wordCount: 0 },
            classification: { pageType: 'failed', confidence: 1 },
            score: 0,
            searchText: `${item.url} ${domainFromUrl(item.url)} fetch failed ${message}`,
            crawledAt: new Date(),
            expiresAt: retentionDate(),
            contentHash: hashContent(message),
            status: 'failed'
          }
        },
        { upsert: true, new: true }
      );

      return {
        url: item.url,
        depth: item.depth,
        links: [],
        pageId: page._id.toString(),
        emailCount: 0,
        socialCount: 0,
        failed: true,
        error: message
      };
    }
  }
}

function toReachabilityMessage(url?: string, detail?: string) {
  const host = url ? domainFromUrl(url) || url : 'the seed URL';
  return `The crawler could not fetch ${host}. Check the URL, network access, SSL, bot protection, or content type.${detail ? ` ${detail}` : ''}`;
}

function buildSearchText(input: {
  url: string;
  domain: string;
  metadata: Metadata;
  emails: string[];
  links: string[];
  social: SocialLinks;
  contentText?: string;
  classification?: string;
}) {
  return [
    input.url,
    input.domain,
    ...Object.values(input.metadata).filter(Boolean).map(String),
    ...input.emails,
    ...input.links,
    ...Object.values(input.social).flat(),
    input.contentText || '',
    input.classification || ''
  ].join(' ');
}

function toLivePage(page: { toObject?: () => Record<string, unknown> }) {
  const value = typeof page.toObject === 'function' ? page.toObject() : page as Record<string, unknown>;
  return {
    ...value,
    _id: String(value._id || ''),
    crawlId: String(value.crawlId || ''),
    parentPageId: value.parentPageId ? String(value.parentPageId) : null
  };
}

function toLiveJob(job: { toObject?: () => Record<string, unknown> }) {
  const value = typeof job.toObject === 'function' ? job.toObject() : job as Record<string, unknown>;
  return {
    ...value,
    _id: String(value._id || '')
  };
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function clampEnvNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}
