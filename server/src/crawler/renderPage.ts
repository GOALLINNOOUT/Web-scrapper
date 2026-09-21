import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { incrementMetric, observeHistogram, setGauge } from '../utils/metrics.js';
import { getRequestIdentity, proxyKey, toPlaywrightProxy } from './requestIdentity.js';

const browserPromises = new Map<string, Promise<unknown>>();
let warnedMissingPlaywright = false;
let activeRenderJobs = 0;
const renderQueue: Array<() => void> = [];
let renderWindowStartedAt = 0;
let renderWindowCount = 0;

export interface RenderedPageSnapshot {
  html: string;
  visibleText: string;
  techStack: string[];
}

export async function renderPageContent(url: string, signal?: AbortSignal): Promise<string | null> {
  const snapshot = await renderPageSnapshot(url, signal);
  return snapshot?.html || null;
}

export async function renderPageSnapshot(url: string, signal?: AbortSignal): Promise<RenderedPageSnapshot | null> {
  if (signal?.aborted) return null;
  if (config.crawlerRenderConcurrency <= 0) {
    incrementMetric('webintel_render_skipped_total', 'Total JavaScript render attempts skipped by reason', { reason: 'disabled' });
    return null;
  }

  const chromium = await loadChromium();
  if (!chromium) return null;

  const identity = getRequestIdentity();
  const browser = await getBrowser(chromium, identity.proxy);
  if (!browser) return null;

  const releaseRenderSlot = await acquireRenderSlot(signal);
  if (!releaseRenderSlot) return null;

  const startedAt = process.hrtime.bigint();
  incrementMetric('webintel_render_attempts_total', 'Total JavaScript render attempts', { status: 'started' });
  let page: PageLike | null = null;

  const renderController = new AbortController();
  const timeout = setTimeout(() => renderController.abort(), config.crawlerRenderTimeoutMs);
  timeout.unref();

  try {
    page = await (browser as BrowserLike).newPage({ userAgent: identity.userAgent }).catch(() => null);
    if (!page) {
      incrementMetric('webintel_render_attempts_total', 'Total JavaScript render attempts', { status: 'failed_to_open_page' });
      return null;
    }
    if (config.crawlerBlockRenderAssets && typeof page.route === 'function') {
      await page.route('**/*', (route) => {
        const request = route.request();
        if (['image', 'media', 'font', 'stylesheet'].includes(request.resourceType())) {
          return route.abort().catch(() => undefined);
        }
        return route.continue().catch(() => undefined);
      }).catch(() => undefined);
    }
    const abort = () => {
      renderController.abort();
      page?.close().catch(() => undefined);
    };
    signal?.addEventListener('abort', abort, { once: true });
    renderController.signal.addEventListener('abort', abort, { once: true });
    if (renderController.signal.aborted || signal?.aborted) return null;

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.crawlerRenderTimeoutMs });
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(Number(process.env.CRAWLER_RENDER_SETTLE_MS || 750)).catch(() => undefined);
    if (signal?.aborted || renderController.signal.aborted) return null;
    const [html, visibleText, techStack] = await Promise.all([
      page.content(),
      page.innerText ? page.innerText('body').catch(() => '') : Promise.resolve(''),
      detectRuntimeTech(page).catch(() => [])
    ]);
    observeHistogram('webintel_render_duration_seconds', 'JavaScript render duration in seconds', Number(process.hrtime.bigint() - startedAt) / 1_000_000_000, { status: 'rendered' });
    incrementMetric('webintel_render_attempts_total', 'Total JavaScript render attempts', { status: 'rendered' });
    return { html, visibleText, techStack };
  } catch {
    const status = renderController.signal.aborted ? 'timeout' : 'failed';
    observeHistogram('webintel_render_duration_seconds', 'JavaScript render duration in seconds', Number(process.hrtime.bigint() - startedAt) / 1_000_000_000, { status });
    incrementMetric('webintel_render_attempts_total', 'Total JavaScript render attempts', { status });
    return null;
  } finally {
    clearTimeout(timeout);
    await page?.close().catch(() => undefined);
    releaseRenderSlot();
  }
}

async function acquireRenderSlot(signal?: AbortSignal) {
  await waitForRenderRate(signal);
  if (signal?.aborted) return null;
  if (activeRenderJobs < config.crawlerRenderConcurrency) {
    activeRenderJobs += 1;
    updateRenderGauges();
    return releaseRenderSlot;
  }
  if (renderQueue.length >= config.crawlerRenderQueueMax) {
    logger.warn({ activeRenderJobs, queueDepth: renderQueue.length, limit: config.crawlerRenderQueueMax }, 'JavaScript rendering skipped because render queue is full');
    incrementMetric('webintel_render_skipped_total', 'Total JavaScript render attempts skipped by reason', { reason: 'queue_full' });
    return null;
  }

  return new Promise<(() => void) | null>((resolve) => {
    const waiter = () => {
      if (signal?.aborted) {
        resolve(null);
        return;
      }
      activeRenderJobs += 1;
      updateRenderGauges();
      resolve(releaseRenderSlot);
    };
    const abort = () => {
      const index = renderQueue.indexOf(waiter);
      if (index >= 0) renderQueue.splice(index, 1);
      updateRenderGauges();
      resolve(null);
    };
    signal?.addEventListener('abort', abort, { once: true });
    renderQueue.push(waiter);
    updateRenderGauges();
  });
}

function releaseRenderSlot() {
  activeRenderJobs = Math.max(0, activeRenderJobs - 1);
  const next = renderQueue.shift();
  updateRenderGauges();
  if (next) next();
}

async function waitForRenderRate(signal?: AbortSignal) {
  const now = Date.now();
  if (now - renderWindowStartedAt >= 1000) {
    renderWindowStartedAt = now;
    renderWindowCount = 0;
  }
  renderWindowCount += 1;
  if (renderWindowCount <= config.crawlerRenderRate) return;
  const delay = Math.max(0, 1000 - (now - renderWindowStartedAt));
  await sleep(delay, signal);
}

function updateRenderGauges() {
  setGauge('webintel_render_active', 'Current active JavaScript render jobs', {}, activeRenderJobs);
  setGauge('webintel_render_queue_depth', 'Current JavaScript render queue depth', {}, renderQueue.length);
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function detectRuntimeTech(page: PageLike) {
  return page.evaluate(() => {
    const detected = new Set<string>();
    const root = globalThis as unknown as Record<string, unknown>;
    const doc = root.document as {
      documentElement?: unknown;
      body?: unknown;
      getElementById?: (id: string) => unknown;
      querySelector?: (selector: string) => unknown;
      querySelectorAll?: (selector: string) => ArrayLike<unknown>;
    } & Record<string, unknown>;

    if (root.__REACT_DEVTOOLS_GLOBAL_HOOK__) detected.add('React');
    if (root.__NEXT_DATA__ || doc.getElementById?.('__NEXT_DATA__')) {
      detected.add('Next.js');
      detected.add('React');
    }
    if (root.__NUXT__ || doc.getElementById?.('__NUXT_DATA__')) detected.add('Nuxt.js');
    if (root.__VUE__ || root.Vue || doc.querySelector?.('[data-v-app]')) detected.add('Vue.js');
    if (root.angular || doc.querySelector?.('[ng-version], [ng-app], [_nghost-ng-c], [_ngcontent-ng-c]')) detected.add('Angular');
    if (doc.querySelector?.('[data-svelte], [class*="svelte-"]')) detected.add('Svelte');

    const sample = Array.from(doc.querySelectorAll?.('*') || []).slice(0, 2000);
    for (const element of [doc.documentElement, doc.body, doc.getElementById?.('root'), ...sample]) {
      if (!element) continue;
      const keys = Object.keys(element as Record<string, unknown>);
      if (keys.some((key) => key.startsWith('__reactFiber$') || key.startsWith('__reactProps$') || key.startsWith('__reactContainer$'))) {
        detected.add('React');
      }
      if (keys.some((key) => key.startsWith('__vueParentComponent') || key.startsWith('__vue_app__'))) {
        detected.add('Vue.js');
      }
    }
    if (Object.keys(doc).some((key) => key.startsWith('__reactContainer$'))) detected.add('React');

    return [...detected].sort();
  });
}

async function loadChromium(): Promise<ChromiumLike | null> {
  try {
    if (process.env.NODE_ENV === 'production' && !process.env.PLAYWRIGHT_BROWSERS_PATH) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
    }
    const module = await import('playwright');
    return module.chromium as ChromiumLike;
  } catch {
    if (!warnedMissingPlaywright) {
      warnedMissingPlaywright = true;
      logger.warn('JavaScript rendering skipped because Playwright is not installed. Run `npm install` and `npx playwright install chromium` to enable it.');
    }
    return null;
  }
}

async function getBrowser(chromium: ChromiumLike, proxy?: Parameters<typeof toPlaywrightProxy>[0]) {
  const key = proxyKey(proxy);
  let browserPromise = browserPromises.get(key);

  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true, proxy: toPlaywrightProxy(proxy) });
    browserPromises.set(key, browserPromise);
  }

  try {
    return await browserPromise;
  } catch (error) {
    browserPromises.delete(key);
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'JavaScript rendering skipped because Chromium could not launch. Run `npx playwright install chromium` in this deployment.');
    return null;
  }
}

interface ChromiumLike {
  launch: (options: { headless: boolean; proxy?: { server: string; username?: string; password?: string } }) => Promise<unknown>;
}

interface BrowserLike {
  newPage: (options: { userAgent: string }) => Promise<PageLike>;
}

interface PageLike {
  route?: (pattern: string, handler: (route: RouteLike) => unknown) => Promise<unknown>;
  goto: (url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }) => Promise<unknown>;
  waitForLoadState: (state: 'networkidle', options: { timeout: number }) => Promise<unknown>;
  waitForTimeout: (timeout: number) => Promise<unknown>;
  evaluate: <T>(callback: () => T) => Promise<T>;
  content: () => Promise<string>;
  innerText?: (selector: string) => Promise<string>;
  close: () => Promise<unknown>;
}

interface RouteLike {
  request: () => { resourceType: () => string };
  abort: () => Promise<unknown>;
  continue: () => Promise<unknown>;
}
