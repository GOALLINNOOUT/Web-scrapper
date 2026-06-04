import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAdmin } from '../context/AdminContext.jsx';

type SocketHandler = (payload: unknown) => void;

export function useSocket(pages: string[] = [], handlers: Record<string, SocketHandler> = {}) {
  const { socket } = useAdmin();
  const handlersRef = useRef(handlers);
  const handlerKeys = Object.keys(handlers).sort().join('|');

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const subscribe = useCallback((nextPages: string[]) => {
    socket?.emit('subscribe', { pages: nextPages });
  }, [socket]);

  useEffect(() => {
    if (socket && pages.length) subscribe(pages);
  }, [pages.join('|'), socket, subscribe]);

  useEffect(() => {
    if (!socket || !handlerKeys) return;
    const events = handlerKeys.split('|').filter(Boolean);
    const listeners = events.map((event) => {
      const listener = (payload: unknown) => handlersRef.current[event]?.(payload);
      socket.on(event, listener);
      return { event, listener };
    });
    return () => {
      for (const { event, listener } of listeners) socket.off(event, listener);
    };
  }, [socket, handlerKeys]);

  return { socket, subscribe };
}

export function useLiveRefresh(pages: string[], events: string[], refresh: () => void, delay = 700) {
  const refreshRef = useRef(refresh);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventKey = events.join('|');

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const scheduleRefresh = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => refreshRef.current(), delay);
  }, [delay]);

  const handlers = useMemo(() => {
    return Object.fromEntries(events.map((event) => [event, scheduleRefresh]));
  }, [eventKey, scheduleRefresh]);

  useSocket(pages, handlers);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}
