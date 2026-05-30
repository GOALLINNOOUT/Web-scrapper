import type { AxiosProxyConfig } from 'axios';
import { config } from '../config/index.js';

export interface RequestIdentity {
  userAgent: string;
  proxy?: ProxyEndpoint;
}

export interface ProxyEndpoint {
  rawUrl: string;
  protocol: 'http' | 'https';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

const userAgents = uniqueNonEmpty([config.crawlerUserAgent, ...config.crawlerUserAgentPool]);
const proxies = config.crawlerProxyUrls.map(parseProxyUrl).filter((proxy): proxy is ProxyEndpoint => Boolean(proxy));

let userAgentIndex = 0;
let proxyIndex = 0;

export function getRequestIdentity(): RequestIdentity {
  const userAgent = nextUserAgent();
  const proxy = nextProxy();
  return proxy ? { userAgent, proxy } : { userAgent };
}

export function toAxiosProxy(proxy?: ProxyEndpoint): AxiosProxyConfig | false {
  if (!proxy) return false;

  return {
    protocol: proxy.protocol,
    host: proxy.host,
    port: proxy.port,
    auth: proxy.username
      ? {
          username: proxy.username,
          password: proxy.password || ''
        }
      : undefined
  };
}

export function toPlaywrightProxy(proxy?: ProxyEndpoint): PlaywrightProxyConfig | undefined {
  if (!proxy) return undefined;

  return {
    server: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
    username: proxy.username,
    password: proxy.password
  };
}

export function proxyKey(proxy?: ProxyEndpoint) {
  return proxy?.rawUrl || 'direct';
}

function nextUserAgent() {
  const userAgent = userAgents[userAgentIndex % userAgents.length] || config.crawlerUserAgent;
  userAgentIndex += 1;
  return userAgent;
}

function nextProxy() {
  if (!proxies.length) return undefined;
  const proxy = proxies[proxyIndex % proxies.length];
  proxyIndex += 1;
  return proxy;
}

function parseProxyUrl(value: string): ProxyEndpoint | null {
  try {
    const url = new URL(value);
    const protocol = url.protocol.replace(':', '');
    if (protocol !== 'http' && protocol !== 'https') return null;

    const port = Number(url.port || (protocol === 'https' ? 443 : 80));
    if (!Number.isFinite(port)) return null;

    return {
      rawUrl: value,
      protocol,
      host: url.hostname,
      port,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined
    };
  } catch {
    return null;
  }
}

function uniqueNonEmpty(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

interface PlaywrightProxyConfig {
  server: string;
  username?: string;
  password?: string;
}
