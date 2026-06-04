import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { useAdmin } from '../context/AdminContext.jsx';

interface MetricsSocketResponse<T> {
  success?: boolean;
  data?: T;
  error?: { message?: string };
}

const responseCache = new Map<string, { expiresAt: number; data: unknown }>();
const pendingRequests = new Map<string, Promise<unknown>>();
const RESPONSE_CACHE_MS = 1_200;

export function useMetrics<T>(endpoint: string, range: string) {
  const { socket, state } = useAdmin();
  const [data, setData] = useState<T | null>(null);
  const lastGood = useRef<T | null>(null);
  const lastKey = useRef('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; cause: string; fix: string } | null>(null);
  const [stale, setStale] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const refetch = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const requestKey = `${endpoint}|${range}`;
    const isNewRequest = lastKey.current !== requestKey;
    if (isNewRequest) {
      lastKey.current = requestKey;
      lastGood.current = null;
      setData(null);
      setStale(false);
    }
    setLoading(isNewRequest || !lastGood.current);
    if (!socket || !state.socketConnected) return;

    let cancelled = false;
    requestMetric<T>(socket, endpoint, range)
      .then((nextData) => {
      if (cancelled) return;
        lastGood.current = nextData;
        setData(nextData);
        setError(null);
        setStale(false);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Metrics request failed';
        setError(explainMetricsError(message));
        setData(lastGood.current);
        setStale(Boolean(lastGood.current));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [endpoint, range, attempt, socket, state.socketConnected]);

  return { data, loading, error, stale, refetch };
}

function requestMetric<T>(socket: Socket, endpoint: string, range: string) {
  const key = `${endpoint}|${range}`;
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.data as T | null);

  const pending = pendingRequests.get(key);
  if (pending) return pending as Promise<T | null>;

  const promise = new Promise<T | null>((resolve, reject) => {
    socket.timeout(15_000).emit('metrics:get', { endpoint, range }, (err: Error | null, body: MetricsSocketResponse<T>) => {
      if (err || !body?.success) {
        reject(new Error(err?.message || body?.error?.message || 'Metrics request failed'));
        return;
      }
      const data = body.data ?? null;
      responseCache.set(key, { expiresAt: Date.now() + RESPONSE_CACHE_MS, data });
      resolve(data);
    });
  }).finally(() => {
    pendingRequests.delete(key);
  });

  pendingRequests.set(key, promise);
  return promise;
}

function explainMetricsError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('failed to fetch') || lower.includes('network')) {
    return {
      message: 'Could not reach the server.',
      cause: 'The dashboard cannot connect to the service that provides live crawl and system data.',
      fix: 'Make sure the server is running, then try again. If other pages work but this does not, refresh the browser.'
    };
  }
  if (lower.includes('404')) {
    return {
      message: 'This dashboard view is not available.',
      cause: 'The server does not recognize the data request for this panel.',
      fix: 'Refresh the app. If it still happens, the dashboard and server versions may not match.'
    };
  }
  if (lower.includes('500') || lower.includes('admin_metrics_error')) {
    return {
      message: 'The server could not prepare this data.',
      cause: 'The dashboard reached the server, but the server had trouble reading or summarizing the latest metrics.',
      fix: 'Try again in a moment. If it keeps happening, check that crawling, database, and queue services are healthy.'
    };
  }
  return {
    message: 'This panel could not load.',
    cause: 'Something interrupted the dashboard data request.',
    fix: 'Retry the panel. If the issue continues, refresh the page and check the server status.'
  };
}
