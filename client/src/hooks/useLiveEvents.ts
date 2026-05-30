import { useEffect } from 'react';
import type { DependencyList } from 'react';
import { API_BASE, clearReadCache } from '../api.js';
import { getDeviceId } from '../device.js';

export interface ClientLiveEvent {
  type: 'workspace.updated' | 'crawl.updated' | 'crawl.page' | 'domain.updated';
  deviceId: string;
  crawlId?: string;
  data?: unknown;
  at: string;
}

export const LIVE_EVENT_NAME = 'web-intel-live';

export function useLiveEvents() {
  useEffect(() => {
    if (!('WebSocket' in window)) return undefined;

    let socket: WebSocket | null = null;
    let connectTimer: number | undefined;
    let reconnectTimer: number | undefined;
    let closed = false;

    const connect = () => {
      if (closed) return;
      socket = new WebSocket(liveWebSocketUrl());
      socket.onmessage = (event: MessageEvent<string>) => {
        try {
          const message = JSON.parse(event.data) as WebSocketLiveMessage;
          if (!isClientLiveEvent(message)) return;
          const detail = message;
          clearReadCache();
          window.dispatchEvent(new CustomEvent<ClientLiveEvent>(LIVE_EVENT_NAME, { detail }));
        } catch {
          // Ignore malformed live messages; the fallback polling still protects freshness.
        }
      };
      socket.onclose = () => {
        if (!closed) reconnectTimer = window.setTimeout(connect, 1500);
      };
    };

    connectTimer = window.setTimeout(connect, 0);

    return () => {
      closed = true;
      window.clearTimeout(connectTimer);
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);
}

function isClientLiveEvent(message: WebSocketLiveMessage): message is ClientLiveEvent {
  return ['workspace.updated', 'crawl.updated', 'crawl.page', 'domain.updated'].includes(String(message.type || ''));
}

type WebSocketLiveMessage = Partial<ClientLiveEvent> & {
  type?: string;
  ok?: boolean;
};

function liveWebSocketUrl() {
  const base = new URL(API_BASE);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = '/events';
  base.search = `deviceId=${encodeURIComponent(getDeviceId())}`;
  return base.toString();
}

export function useLiveRefresh(callback: (event: ClientLiveEvent) => void, deps: DependencyList = []) {
  useEffect(() => {
    let timer: number | undefined;
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<ClientLiveEvent>).detail;
      if (detail.type === 'crawl.page') {
        callback(detail);
        return;
      }

      window.clearTimeout(timer);
      timer = window.setTimeout(() => callback(detail), 250);
    };

    window.addEventListener(LIVE_EVENT_NAME, listener);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(LIVE_EVENT_NAME, listener);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
