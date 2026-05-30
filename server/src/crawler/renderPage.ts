import { logger } from '../utils/logger.js';
import { getRequestIdentity, proxyKey, toPlaywrightProxy } from './requestIdentity.js';

const browserPromises = new Map<string, Promise<unknown>>();
let warnedMissingPlaywright = false;

export interface RenderedPageSnapshot {
  html: string;
  techStack: string[];
}

export async function renderPageContent(url: string, signal?: AbortSignal): Promise<string | null> {
  const snapshot = await renderPageSnapshot(url, signal);
  return snapshot?.html || null;
}

export async function renderPageSnapshot(url: string, signal?: AbortSignal): Promise<RenderedPageSnapshot | null> {
  if (signal?.aborted) return null;

  const chromium = await loadChromium();
  if (!chromium) return null;

  const identity = getRequestIdentity();
  const browser = await getBrowser(chromium, identity.proxy);
  if (!browser) return null;

  const page = await (browser as BrowserLike).newPage({ userAgent: identity.userAgent }).catch(() => null);
  if (!page) return null;

  const abort = () => {
    page.close().catch(() => undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(Number(process.env.CRAWLER_RENDER_SETTLE_MS || 750)).catch(() => undefined);
    if (signal?.aborted) return null;
    const [html, techStack] = await Promise.all([
      page.content(),
      detectRuntimeTech(page).catch(() => [])
    ]);
    return { html, techStack };
  } catch {
    return null;
  } finally {
    signal?.removeEventListener('abort', abort);
    await page.close().catch(() => undefined);
  }
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
  } catch {
    browserPromises.delete(key);
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
  goto: (url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }) => Promise<unknown>;
  waitForLoadState: (state: 'networkidle', options: { timeout: number }) => Promise<unknown>;
  waitForTimeout: (timeout: number) => Promise<unknown>;
  evaluate: <T>(callback: () => T) => Promise<T>;
  content: () => Promise<string>;
  close: () => Promise<unknown>;
}
