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
    if (!('WebSocket' in window) && !('EventSource' in window)) return undefined;

    let socket: WebSocket | null = null;
    let eventSource: EventSource | null = null;
    let connectTimer: number | undefined;
    let reconnectTimer: number | undefined;
    let closed = false;
    let connected = false;

    const dispatchLiveMessage = (raw: string) => {
      try {
        const message = JSON.parse(raw) as WebSocketLiveMessage;
        if (!isClientLiveEvent(message)) return;
        const detail = message;
        clearReadCache();
        window.dispatchEvent(new CustomEvent<ClientLiveEvent>(LIVE_EVENT_NAME, { detail }));
      } catch {
        // Ignore malformed live messages; the fallback polling still protects freshness.
      }
    };

    const connectEventSource = () => {
      if (closed || eventSource || !('EventSource' in window)) return;
      eventSource = new EventSource(liveHttpUrl());
      for (const type of LIVE_EVENT_TYPES) {
        eventSource.addEventListener(type, (event) => {
          dispatchLiveMessage((event as MessageEvent<string>).data);
        });
      }
      eventSource.onerror = () => {
        connected = false;
      };
    };

    const connect = () => {
      if (closed) return;
      if (!('WebSocket' in window)) {
        connectEventSource();
        return;
      }
      socket = new WebSocket(liveWebSocketUrl());
      socket.onopen = () => {
        connected = true;
        eventSource?.close();
        eventSource = null;
      };
      socket.onmessage = (event: MessageEvent<string>) => {
        connected = true;
        dispatchLiveMessage(event.data);
      };
      socket.onerror = () => {
        if (!connected) connectEventSource();
      };
      socket.onclose = () => {
        if (!closed) {
          if (!connected) connectEventSource();
          reconnectTimer = window.setTimeout(connect, 1500);
        }
      };
    };

    connectTimer = window.setTimeout(connect, 0);

    return () => {
      closed = true;
      window.clearTimeout(connectTimer);
      window.clearTimeout(reconnectTimer);
      socket?.close();
      eventSource?.close();
    };
  }, []);
}

function isClientLiveEvent(message: WebSocketLiveMessage): message is ClientLiveEvent {
  return LIVE_EVENT_TYPES.includes(String(message.type || '') as ClientLiveEvent['type']);
}

const LIVE_EVENT_TYPES: ClientLiveEvent['type'][] = ['workspace.updated', 'crawl.updated', 'crawl.page', 'domain.updated'];

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

function liveHttpUrl() {
  const base = new URL(API_BASE);
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
