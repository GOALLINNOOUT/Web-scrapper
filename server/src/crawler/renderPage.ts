import { logger } from '../utils/logger.js';
import { getRequestIdentity, proxyKey, toPlaywrightProxy } from './requestIdentity.js';

const browserPromises = new Map<string, Promise<unknown>>();
let warnedMissingPlaywright = false;

export async function renderPageContent(url: string, signal?: AbortSignal): Promise<string | null> {
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
    return await page.content();
  } catch {
    return null;
  } finally {
    signal?.removeEventListener('abort', abort);
    await page.close().catch(() => undefined);
  }
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
  content: () => Promise<string>;
  close: () => Promise<unknown>;
}
