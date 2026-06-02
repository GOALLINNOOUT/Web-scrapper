import { getDeviceId } from './device.js';
import { AppError, appErrorFromResponse, toastTitleForError } from './lib/errors.js';
import { showToast } from './toast.js';
import type { AlertEvent, ChangeEvent, CrawlConfig, CrawlJob, CrawlPage, CrawlSummary, CursorPage, DataFilters, DomainProfile, MetadataPreview, MonitoringProfile, MonitoringSummary, WorkspaceSettings } from './types.js';

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';
const DEFAULT_GET_CACHE_MS = 2500;

interface ApiRequestInit extends RequestInit {
  cacheMs?: number;
  skipCache?: boolean;
}

const readCache = new Map<string, { expiresAt: number; value: unknown }>();
const pendingReads = new Map<string, Promise<unknown>>();

export function clearReadCache() {
  readCache.clear();
}

async function request<T>(path: string, options: ApiRequestInit = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const canUseCache = method === 'GET' && !options.skipCache;
  const cacheMs = options.cacheMs ?? getReadCacheTtl(path);

  if (canUseCache && cacheMs > 0) {
    const cached = readCache.get(path);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;

    const pending = pendingReads.get(path);
    if (pending) return pending as Promise<T>;
  }

  const requestPath = method === 'GET' ? withDeviceQuery(path) : path;
  const headers = method === 'GET'
    ? options.headers
    : {
        'Content-Type': 'application/json',
        'X-Device-Id': getDeviceId(),
        ...(options.headers || {})
      };

  const promise = fetch(`${API_BASE}${requestPath}`, {
    ...options,
    headers
  })
    .then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => ({} as { message?: string; error?: string }));
        const message = body.message || body.error || `Request failed: ${response.status}`;
        const error = appErrorFromResponse(response.status, message);
        showToast({ title: toastTitleForError(error), description: `${error.message} ${error.action}`, tone: error.kind === 'validation' ? 'warning' : 'error' });
        throw error;
      }

      const value = await response.json() as T;
      if (canUseCache && cacheMs > 0) {
        readCache.set(path, { expiresAt: Date.now() + cacheMs, value });
      } else if (method !== 'GET') {
        readCache.clear();
      }

      return value;
    })
    .catch((error) => {
      if (error instanceof AppError) throw error;
      const appError = navigator.onLine
        ? new AppError('Could not reach the server.', { kind: 'server', action: 'Check the server is running, then try again.' })
        : new AppError('You are offline.', { kind: 'offline', action: 'Turn on Wi-Fi or mobile data, then try again.' });
      showToast({ title: toastTitleForError(appError), description: appError.action, tone: appError.kind === 'offline' ? 'warning' : 'error' });
      throw appError;
    })
    .finally(() => {
      if (canUseCache) pendingReads.delete(path);
    });

  if (canUseCache && cacheMs > 0) pendingReads.set(path, promise);
  return promise;
}

function withDeviceQuery(path: string) {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}deviceId=${encodeURIComponent(getDeviceId())}`;
}

function getReadCacheTtl(path: string) {
  if (path === '/crawl') return 5000;
  if (path.startsWith('/crawl/') && path.includes('/results')) return 5000;
  if (path.startsWith('/crawl/') && path.includes('/summary')) return 7500;
  if (path.startsWith('/crawl/')) return 5000;
  if (path.startsWith('/monitoring')) return 10_000;
  if (path.startsWith('/settings')) return 10_000;
  if (path.startsWith('/data?')) return 7500;
  if (path.startsWith('/domain')) return 30_000;
  return DEFAULT_GET_CACHE_MS;
}

export const api = {
  listCrawls: () => request<CrawlJob[]>('/crawl'),
  createCrawl: (payload: CrawlConfig) => request<CrawlJob>('/crawl', {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  getCrawl: (id: string) => request<CrawlJob>(`/crawl/${id}`),
  getCrawlSummary: (id: string) => request<CrawlSummary>(`/crawl/${id}/summary`),
  getCrawlResults: (id: string, params: { limit?: number; cursor?: string | null } = {}) => {
    const search = new URLSearchParams({ limit: String(params.limit ?? 25) });
    if ('cursor' in params && params.cursor) search.set('cursor', String(params.cursor));
    return request<CursorPage<CrawlPage>>(`/crawl/${id}/results?${search.toString()}`);
  },
  stopCrawl: (id: string) => request<CrawlJob>(`/crawl/${id}/stop`, { method: 'POST' }),
  pauseCrawl: (id: string) => request<CrawlJob>(`/crawl/${id}/pause`, { method: 'POST' }),
  continueCrawl: (id: string) => request<CrawlJob>(`/crawl/${id}/resume`, { method: 'POST' }),
  retryCrawl: (id: string) => request<CrawlJob>(`/crawl/${id}/retry`, { method: 'POST' }),
  getData: (params: DataFilters = {}) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
    });
    return request<CursorPage<CrawlPage>>(`/data?${search.toString()}`);
  },
  searchWorkspace: (q: string, params: { limit?: number; cursor?: string | null } = {}) => {
    return api.getData({ q, limit: params.limit ?? 10, cursor: params.cursor });
  },
  getDomains: (limit = 25) => request<{ items: DomainProfile[] }>(`/domain?limit=${limit}`),
  getDomain: (domain: string) => request<DomainProfile>(`/domain/${encodeURIComponent(domain)}`),
  lookupDomain: (domain: string, refresh = false) => request<DomainProfile>(`/domain/lookup${refresh ? '?refresh=true' : ''}`, {
    method: 'POST',
    body: JSON.stringify({ domain })
  }),
  enrichDomain: (domain: string) => request<DomainProfile>(`/domain/${encodeURIComponent(domain)}/enrich`, { method: 'POST' }),
  getMonitoring: () => request<MonitoringSummary>('/monitoring'),
  createMonitoringProfile: (payload: { domain: string; monitoringType: MonitoringProfile['monitoringType']; schedule?: MonitoringProfile['schedule']; sensitivity?: MonitoringProfile['sensitivity'] }) => request<{ profile: MonitoringProfile; discoveryCrawl: CrawlJob }>('/monitoring/profiles', {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  acceptMonitoringSuggestion: (payload: { url: string; monitoringType?: MonitoringProfile['monitoringType'] }) => request<MonitoringProfile>('/monitoring/suggestions/accept', {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  getMonitoringProfile: (domain: string) => request<{ profile: MonitoringProfile; events: ChangeEvent[]; domain?: DomainProfile }>(`/monitoring/profiles/${encodeURIComponent(domain)}`),
  updateMonitoringProfile: (id: string, payload: Partial<Pick<MonitoringProfile, 'monitoredPages' | 'recommendedPages' | 'schedule' | 'sensitivity' | 'enabled'>>) => request<MonitoringProfile>(`/monitoring/profiles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  }),
  acceptMonitoringRecommendations: (id: string) => request<MonitoringProfile>(`/monitoring/profiles/${id}/accept-recommendations`, { method: 'POST' }),
  markChangeRead: (id: string) => request<ChangeEvent>(`/monitoring/events/${id}/read`, { method: 'PATCH' }),
  getAlerts: (limit = 25) => request<{ items: AlertEvent[] }>(`/alerts?limit=${limit}`),
  getSettings: () => request<WorkspaceSettings>('/settings'),
  updateSettings: (payload: Partial<WorkspaceSettings>) => request<WorkspaceSettings>('/settings', {
    method: 'PATCH',
    body: JSON.stringify(payload)
  }),
  previewMetadata: (url: string) => request<MetadataPreview>('/metadata/preview', {
    method: 'POST',
    body: JSON.stringify({ url })
  })
};
