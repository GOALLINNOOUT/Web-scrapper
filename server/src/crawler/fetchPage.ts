import axios from 'axios';
import http from 'node:http';
import https from 'node:https';
import { config } from '../config/index.js';
import { getRequestIdentity, toAxiosProxy } from './requestIdentity.js';

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: Number(process.env.HTTP_AGENT_MAX_SOCKETS || 200),
  maxFreeSockets: 50,
  timeout: 10_000,
  scheduling: 'fifo'
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: Number(process.env.HTTP_AGENT_MAX_SOCKETS || 200),
  maxFreeSockets: 50,
  timeout: 10_000,
  rejectUnauthorized: process.env.CRAWLER_REJECT_UNAUTHORIZED === 'true'
});

const client = axios.create({
  timeout: 15_000,
  maxContentLength: config.crawlerMaxContentBytes,
  maxBodyLength: config.crawlerMaxContentBytes,
  maxRedirects: 5,
  httpAgent,
  httpsAgent,
  responseType: 'text',
  headers: baseHeaders(),
  validateStatus: (status) => status >= 200 && status < 400
});

export interface FetchPageResult {
  html: string;
  headers: Record<string, unknown>;
  statusCode: number;
  finalUrl: string;
}

export async function fetchPage(url: string, retries = 2, signal?: AbortSignal): Promise<string> {
  const result = await fetchPageResult(url, retries, signal);
  return result.html;
}

export async function fetchPageResult(url: string, retries = 2, signal?: AbortSignal): Promise<FetchPageResult> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw new Error('Fetch aborted');

    try {
      const identity = getRequestIdentity();
      const response = await client.get(url, {
        signal,
        headers: {
          ...baseHeaders(),
          'User-Agent': identity.userAgent
        },
        proxy: toAxiosProxy(identity.proxy)
      });

      const contentType = String(response.headers['content-type'] || '');
      if (!url.endsWith('/robots.txt') && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        throw new Error(`Unsupported content type: ${contentType || 'unknown'}`);
      }

      return {
        html: String(response.data),
        headers: response.headers,
        statusCode: response.status,
        finalUrl: response.request?.res?.responseUrl || url
      };
    } catch (error) {
      lastError = normalizeFetchError(error);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to fetch page');
}

function normalizeFetchError(error: unknown) {
  if (axios.isAxiosError(error) && String(error.message || '').includes('maxContentLength')) {
    const friendly = new Error(`Page exceeds crawler size limit of ${formatBytes(config.crawlerMaxContentBytes)}. Increase CRAWLER_MAX_CONTENT_BYTES if this target is trusted.`);
    (friendly as Error & { status?: number }).status = 413;
    return friendly;
  }

  if (axios.isAxiosError(error) && String(error.message || '').includes('maxBodyLength')) {
    const friendly = new Error(`Response exceeds crawler size limit of ${formatBytes(config.crawlerMaxContentBytes)}. Increase CRAWLER_MAX_CONTENT_BYTES if this target is trusted.`);
    (friendly as Error & { status?: number }).status = 413;
    return friendly;
  }

  return error;
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

function baseHeaders() {
  return {
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.9'
  };
}
