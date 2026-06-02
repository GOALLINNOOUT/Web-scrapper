import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { CrawlJob } from '../models/CrawlJob.js';
import { Page } from '../models/Page.js';
import type { QueueBundle } from '../queue/queues.js';
import { config } from '../config/index.js';
import type { CrawlConfig, SocialLinks } from '../types.js';
import { runExtractorPipeline } from '../extractors/pipeline.js';
import { emptySocial } from '../extractors/social.js';
import { archiveRawHtml, encryptPageContent, shouldEncryptStoredPageText, decryptPageDocument } from './changePayloadCrypto.js';
import { createDailyEmailAlert } from './alertService.js';
import { updateCrawlSummaryForPage, rebuildCrawlSummary } from './crawlSummaryService.js';
import { detectPageChanges } from './changeDetectionService.js';
import { rebuildDomainProfile } from '../intelligence/domain.service.js';
import { invalidateCrawlReads, invalidateDomainReads } from './cacheInvalidation.js';
import { publishLiveEvent } from './liveEvents.js';
import { retentionDate } from '../utils/retention.js';
import { domainFromUrl } from '../utils/url.js';
import { hashContent } from '../utils/hash.js';
import { incrementMetric } from '../utils/metrics.js';
import { logger } from '../utils/logger.js';

type GoEventType = 'crawl_started' | 'page_started' | 'page_result' | 'page_failed' | 'links_discovered' | 'crawl_finished' | 'crawl_error';
type ExtractedPage = Awaited<ReturnType<typeof runExtractorPipeline>>;

interface GoEvent {
  type?: GoEventType;
  url?: string;
  finalUrl?: string;
  parentUrl?: string;
  depth?: number;
  statusCode?: number;
  title?: string;
  description?: string;
  links?: string[];
  emails?: string[];
  text?: string;
  textSnippet?: string;
  contentHash?: string;
  html?: string;
  renderUsed?: boolean;
  error?: string;
  reason?: string;
  pagesCrawled?: number;
}

const running = new Map<string, ChildProcessWithoutNullStreams>();

export async function runGoCrawlJob(crawlId: string, deviceId: string, queues?: QueueBundle) {
  const job = await CrawlJob.findOneAndUpdate(
    { _id: crawlId, deviceId, status: { $nin: ['completed', 'stopped', 'failed'] } },
    { $set: { status: 'running', startedAt: new Date(), error: null, deadLetterReason: null } },
    { new: true }
  ).lean();
  if (!job) throw new Error('Crawl job not found');

  const crawlConfig = job.config as unknown as CrawlConfig;
  const child = spawnGoCrawler(crawlConfig);
  running.set(crawlId, child);
  let stderr = '';
  let finished = false;
  let finishReason = '';
  let lastOutputAt = Date.now();
  let stoppedByRequest = false;
  const idleTimeoutMs = Math.max(
    config.goCrawlerIdleTimeoutMs,
    config.crawlerRenderConcurrency > 0 ? config.crawlerRenderTimeoutMs * 6 : 0,
    config.crawlerRenderConcurrency > 0 ? 180_000 : 0
  );

  child.stderr.on('data', (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-5000);
  });

  const stopTimer = setInterval(async () => {
    const latest = await CrawlJob.findOne({ _id: crawlId, deviceId }, { requestedStop: 1, status: 1 }).lean().catch(() => null);
    if (latest?.requestedStop || latest?.status === 'stopped') {
      stoppedByRequest = true;
      child.kill('SIGTERM');
      return;
    }
    if (Date.now() - lastOutputAt > idleTimeoutMs) {
      stderr = `${stderr}\nGo crawler idle timeout after ${idleTimeoutMs}ms`.slice(-5000);
      child.kill('SIGTERM');
    }
  }, 2000);
  stopTimer.unref();

  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    lastOutputAt = Date.now();
    void handleGoLine(line, { crawlId, deviceId, crawlConfig, queues }).then((event) => {
      if (event?.type === 'crawl_finished') {
        finished = true;
        finishReason = String(event.reason || 'complete');
      }
      if (event?.type === 'crawl_error') {
        finishReason = String(event.reason || event.error || 'crawl_error');
      }
    }).catch((error) => {
      logger.warn({ crawlId, err: error instanceof Error ? error.message : String(error) }, 'Unable to process Go crawler event');
    });
  });

  child.stdin.end(JSON.stringify(toGoConfig(crawlConfig)));

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; spawnError?: Error }>((resolve) => {
    child.once('error', (error) => resolve({ code: null, signal: null, spawnError: error }));
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
  clearInterval(stopTimer);
  running.delete(crawlId);
  logger.info({
    crawlId,
    code: exit.code,
    signal: exit.signal,
    spawnError: exit.spawnError?.message,
    finished,
    finishReason,
    idleTimeoutMs
  }, 'Go crawler CLI exited');

  const latest = await CrawlJob.findOne({ _id: crawlId, deviceId }, { status: 1, requestedStop: 1 }).lean();
  if (latest?.requestedStop || stoppedByRequest || latest?.status === 'stopped') {
    await finalizeGoCrawl(deviceId, crawlId, 'stopped', 'Stopped by user');
    return { crawlId, status: 'stopped' };
  }
  if (finished && exit.code === 0) {
    await finalizeGoCrawl(deviceId, crawlId, 'completed');
    if (queues) {
      await queues.domainEnrichment.add('refresh-domain-after-go-crawl', { deviceId, crawlId }, { delay: 10_000, attempts: 2 }).catch(() => undefined);
    }
    return { crawlId, status: 'completed', reason: finishReason };
  }

  const interrupted = exit.code === 3 || finishReason === 'runtime_budget_exceeded' || exit.signal === 'SIGTERM';
  await finalizeGoCrawl(
    deviceId,
    crawlId,
    interrupted ? 'interrupted' : 'failed',
    interrupted ? 'Crawl interrupted before completion; retry is available.' : (exit.spawnError?.message || stderr.trim() || finishReason || `Go crawler exited with code ${exit.code}`)
  );
  return { crawlId, status: interrupted ? 'interrupted' : 'failed' };
}

export async function markInterruptedCrawlsOnStartup() {
  if (!config.goCrawlerEnabled) return;
  const result = await CrawlJob.updateMany(
    { status: 'running' },
    {
      $set: {
        status: 'interrupted',
        requestedPause: false,
        requestedStop: false,
        error: 'Server restarted while crawl was running; retry is available.',
        deadLetterReason: 'server_restart',
        completedAt: new Date()
      }
    }
  );
  if (result.modifiedCount > 0) {
    logger.warn({ interrupted: result.modifiedCount }, 'Marked running Go crawls as interrupted after startup');
  }
}

async function handleGoLine(line: string, context: { crawlId: string; deviceId: string; crawlConfig: CrawlConfig; queues?: QueueBundle }) {
  const event = JSON.parse(line) as GoEvent;
  if (event.type === 'page_result') {
    await persistGoPage(event, context);
  } else if (event.type === 'page_failed') {
    await persistGoFailedPage(event, context);
  } else if (event.type === 'crawl_started') {
    await publishLiveEvent({
      type: 'crawl.updated',
      deviceId: context.deviceId,
      crawlId: context.crawlId,
      data: { job: { status: 'running' } }
    }).catch(() => undefined);
  } else if (event.type === 'crawl_error') {
    logger.warn({ crawlId: context.crawlId, error: event.error, reason: event.reason }, 'Go crawler reported crawl error');
  }
  return event;
}

async function persistGoPage(event: GoEvent, context: { crawlId: string; deviceId: string; crawlConfig: CrawlConfig }) {
  const url = String(event.url || event.finalUrl || '');
  if (!url) return;
  const finalUrl = String(event.finalUrl || url);
  const domain = domainFromUrl(finalUrl || url);
  let html = String(event.html || '');
  let extracted = html
    ? await runExtractorPipeline(html, finalUrl, {}, { includeMetaLinks: context.crawlConfig.discovery.includeMetaLinks })
    : fallbackExtracted(event);
  const renderUsed = Boolean(event.renderUsed);

  const alreadyStored = await Page.exists({ deviceId: context.deviceId, crawlId: context.crawlId, url });
  const page = await Page.findOneAndUpdate(
    { deviceId: context.deviceId, crawlId: context.crawlId, url },
    {
      $set: {
        deviceId: context.deviceId,
        workspaceId: context.deviceId,
        crawlId: new Types.ObjectId(context.crawlId),
        url,
        domain,
        depth: Number(event.depth || 0),
        parentUrl: event.parentUrl || null,
        parentPageId: null,
        discoveredFrom: event.parentUrl || null,
        metadata: extracted.metadata,
        links: extracted.links,
        emails: extracted.emails,
        social: extracted.social,
        techStack: extracted.techStack,
        content: encryptPageContent(extracted.content),
        rawHtmlArchive: archiveRawHtml(html),
        classification: extracted.classification,
        score: extracted.score,
        searchText: buildSearchText(url, domain, extracted),
        crawledAt: new Date(),
        expiresAt: retentionDate(),
        contentHash: extracted.contentHash,
        status: 'crawled'
      }
    },
    { upsert: true, new: true }
  );

  const socialLinksFound = new Set(Object.values(extracted.social).flat()).size;
  const updated = await CrawlJob.findOneAndUpdate(
    { _id: context.crawlId, deviceId: context.deviceId, status: { $nin: ['completed', 'stopped', 'failed', 'interrupted'] } },
    {
      $set: { status: 'running' },
      ...(alreadyStored ? {} : { $inc: { pagesCrawled: 1, emailsFound: extracted.emails.length, socialLinksFound } })
    },
    { new: true }
  ).lean();

  if (extracted.emails.length > 0) {
    await createDailyEmailAlert({
      deviceId: context.deviceId,
      domain,
      crawlId: context.crawlId,
      pageUrl: url,
      emails: extracted.emails
    }).catch(() => undefined);
  }
  await updateCrawlSummaryForPage({
    deviceId: context.deviceId,
    crawlId: context.crawlId,
    pageUrl: url,
    emails: extracted.emails,
    social: extracted.social as unknown as Record<string, string[] | undefined>,
    techStack: extracted.techStack
  }).catch(() => undefined);
  await detectPageChanges({
    deviceId: context.deviceId,
    workspaceId: context.deviceId,
    url,
    crawlId: context.crawlId,
    contentHash: extracted.contentHash
  }).catch(() => undefined);
  await invalidateCrawlReads(context.deviceId, context.crawlId, { publish: false }).catch(() => undefined);
  await publishLiveEvent({
    type: 'crawl.page',
    deviceId: context.deviceId,
    crawlId: context.crawlId,
    data: {
      page: toLivePage(page),
      job: {
        pagesCrawled: updated?.pagesCrawled || 0,
        emailsFound: updated?.emailsFound || 0,
        socialLinksFound: updated?.socialLinksFound || 0,
        status: updated?.status || 'running'
      }
    }
  }).catch(() => undefined);
  incrementMetric('webintel_page_fetch_mode_total', 'Total crawled pages by fetch mode', { mode: renderUsed ? 'go_http_plus_render' : 'go_http_only' });
  incrementMetric('webintel_pages_crawled_total', 'Total pages processed by crawl workers', { status: 'crawled', page_type: extracted.classification.pageType });
}

async function persistGoFailedPage(event: GoEvent, context: { crawlId: string; deviceId: string }) {
  const url = String(event.url || '');
  if (!url) return;
  const domain = domainFromUrl(url);
  const message = String(event.error || 'Go crawler page failed');
  await Page.findOneAndUpdate(
    { deviceId: context.deviceId, crawlId: context.crawlId, url },
    {
      $set: {
        deviceId: context.deviceId,
        workspaceId: context.deviceId,
        crawlId: new Types.ObjectId(context.crawlId),
        url,
        domain,
        depth: Number(event.depth || 0),
        parentUrl: event.parentUrl || null,
        links: [],
        emails: [],
        social: emptySocial(),
        techStack: [],
        content: { text: '', headings: [], paragraphs: [], wordCount: 0 },
        classification: { pageType: 'failed', confidence: 1 },
        score: 0,
        searchText: `${url} ${domain} fetch failed ${message}`,
        crawledAt: new Date(),
        expiresAt: retentionDate(),
        contentHash: hashContent(message),
        status: 'failed'
      }
    },
    { upsert: true, new: true }
  );
  incrementMetric('webintel_pages_crawled_total', 'Total pages processed by crawl workers', { status: 'failed', page_type: 'failed' });
}

async function finalizeGoCrawl(deviceId: string, crawlId: string, status: 'completed' | 'stopped' | 'failed' | 'interrupted', error?: string) {
  const updated = await CrawlJob.findOneAndUpdate(
    { _id: crawlId, deviceId },
    {
      $set: {
        status,
        requestedPause: false,
        requestedStop: status === 'stopped',
        completedAt: new Date(),
        ...(error ? { error, deadLetterReason: error } : { error: null })
      }
    },
    { new: true }
  ).lean();
  await rebuildCrawlSummary(deviceId, crawlId).catch(() => undefined);
  if (updated?.seedUrl) {
    await rebuildDomainProfile(deviceId, domainFromUrl(updated.seedUrl)).catch(() => undefined);
    await invalidateDomainReads(deviceId).catch(() => undefined);
  }
  await invalidateCrawlReads(deviceId, crawlId, { publish: false }).catch(() => undefined);
  await publishLiveEvent({
    type: 'crawl.updated',
    deviceId,
    crawlId,
    data: {
      job: {
        status,
        pagesCrawled: updated?.pagesCrawled || 0,
        emailsFound: updated?.emailsFound || 0,
        socialLinksFound: updated?.socialLinksFound || 0,
        error: updated?.error || null
      }
    }
  }).catch(() => undefined);
}

function spawnGoCrawler(crawlConfig: CrawlConfig) {
  const { bin, args } = resolveGoCrawlerCommand();
  logger.info({ command: bin, args }, 'Starting Go crawler CLI');
  return spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
}

function resolveGoCrawlerCommand() {
  if (config.goCrawlerCommand) {
    const [bin, ...args] = config.goCrawlerCommand.split(' ').filter(Boolean);
    return { bin, args };
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const names = process.platform === 'win32' ? ['crawler-go.exe', 'crawler.exe'] : ['crawler-go', 'crawler'];
  const roots = [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(here, '../../../..'),
    path.resolve(here, '../../..')
  ];
  const candidates = [
    ...roots.flatMap((root) => names.map((name) => path.resolve(root, 'services', 'crawler-go', name))),
    ...roots.map((root) => path.resolve(root, 'services', 'crawler-go'))
  ];
  const binary = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (binary) return { bin: binary, args: [] };

  const sourceDir = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory());
  if (sourceDir) return { bin: resolveGoExecutable(), args: ['run', sourceDir] };

  return { bin: path.resolve(process.cwd(), '..', 'services', 'crawler-go', names[0]), args: [] };
}

function resolveGoExecutable() {
  if (process.platform === 'win32') {
    const standard = 'C:\\Program Files\\Go\\bin\\go.exe';
    if (fs.existsSync(standard)) return standard;
  }
  return 'go';
}

function toGoConfig(crawlConfig: CrawlConfig) {
  return {
    seedUrl: crawlConfig.seedUrl,
    maxDepth: crawlConfig.maxDepth,
    maxPages: config.goCrawlerNoPageCap ? 0 : crawlConfig.maxPages,
    sameDomainOnly: crawlConfig.sameDomainOnly,
    concurrency: config.goCrawlerFetchConcurrency,
    requestTimeoutMs: Math.min(config.crawlerRenderTimeoutMs, 20_000),
    maxRuntimeMs: config.goCrawlerRuntimeMinutes * 60 * 1000,
    maxResponseBytes: config.crawlerMaxContentBytes,
    userAgent: config.crawlerUserAgent,
    renderWhenStaticLinksBelow: crawlConfig.discovery.renderWhenStaticLinksBelow,
    renderEnabled: crawlConfig.discovery.renderJavaScript,
    renderConcurrency: Math.max(1, Math.min(2, config.crawlerRenderConcurrency || 1)),
    renderTimeoutMs: config.crawlerRenderTimeoutMs,
    includeContent: crawlConfig.extract.content !== false
  };
}

function fallbackExtracted(event: GoEvent): ExtractedPage {
  const text = String(event.text || event.textSnippet || '');
  const links = Array.isArray(event.links) ? event.links.map(String) : [];
  const emails = Array.isArray(event.emails) ? event.emails.map(String) : [];
  const social = emptySocial();
  return {
    links,
    emails,
    metadata: {
      title: String(event.title || ''),
      description: String(event.description || '')
    },
    social,
    content: {
      text,
      headings: [],
      paragraphs: text ? [text] : [],
      wordCount: text ? text.split(/\s+/).filter(Boolean).length : 0
    },
    techStack: [],
    classification: { pageType: 'general', confidence: 0.5 },
    score: 0,
    contentHash: event.contentHash || hashContent(text)
  } as ExtractedPage;
}

function buildSearchText(url: string, domain: string, extracted: ExtractedPage) {
  return [
    url,
    domain,
    ...Object.values(extracted.metadata).filter(Boolean).map(String),
    ...extracted.emails,
    ...extracted.links,
    ...Object.values(extracted.social).flat(),
    ...extracted.techStack,
    shouldEncryptStoredPageText() ? '' : extracted.content.text,
    extracted.classification.pageType
  ].join(' ');
}

function toLivePage(page: { toObject?: () => Record<string, unknown> }) {
  const value = typeof page.toObject === 'function' ? page.toObject() : page as Record<string, unknown>;
  const decrypted = decryptPageDocument(value as { content?: { text?: string } }) as Record<string, unknown>;
  return {
    ...decrypted,
    _id: String(decrypted._id || ''),
    crawlId: String(decrypted.crawlId || ''),
    parentPageId: decrypted.parentPageId ? String(decrypted.parentPageId) : null
  };
}
