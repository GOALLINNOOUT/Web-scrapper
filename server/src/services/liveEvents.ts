import type { Response } from 'express';
import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from '../config/index.js';
import { createRedisConnection } from '../queue/connection.js';
import { logger } from '../utils/logger.js';

export type LiveEventType = 'workspace.updated' | 'crawl.updated' | 'crawl.page' | 'domain.updated';

export interface LiveEvent {
  type: LiveEventType;
  deviceId: string;
  crawlId?: string;
  data?: unknown;
  at: string;
}

const CHANNEL = 'web-intel:live-events';
const clients = new Map<string, Set<Response>>();
const sockets = new Map<string, Set<WebSocket>>();
let subscriberStarted = false;
let publisher: ReturnType<typeof createRedisConnection> | null = null;
let socketServerStarted = false;

const DEVICE_ID_RE = /^[a-zA-Z0-9._:-]{8,96}$/;

export function attachLiveWebSocketServer(server: HttpServer) {
  if (socketServerStarted) return;
  socketServerStarted = true;

  const wss = new WebSocketServer({ server, path: '/events' });
  wss.on('connection', (socket, request) => {
    const url = new URL(request.url || '/events', 'http://localhost');
    const deviceId = String(url.searchParams.get('deviceId') || '').trim();
    if (!DEVICE_ID_RE.test(deviceId)) {
      socket.close(1008, 'Invalid deviceId');
      return;
    }

    const deviceSockets = sockets.get(deviceId) || new Set<WebSocket>();
    deviceSockets.add(socket);
    sockets.set(deviceId, deviceSockets);
    startRedisSubscriber();

    socket.send(JSON.stringify({ type: 'connected', ok: true }));
    const heartbeat = setInterval(() => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping', at: new Date().toISOString() }));
      }
    }, 25_000);

    socket.on('close', () => {
      clearInterval(heartbeat);
      deviceSockets.delete(socket);
      if (deviceSockets.size === 0) sockets.delete(deviceId);
    });
  });
}

export function addLiveClient(deviceId: string, res: Response) {
  const deviceClients = clients.get(deviceId) || new Set<Response>();
  deviceClients.add(res);
  clients.set(deviceId, deviceClients);
  startRedisSubscriber();

  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  const heartbeat = setInterval(() => {
    res.write(`event: ping\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  }, 25_000);

  res.on('close', () => {
    clearInterval(heartbeat);
    deviceClients.delete(res);
    if (deviceClients.size === 0) clients.delete(deviceId);
  });
}

export async function publishLiveEvent(event: Omit<LiveEvent, 'at'>) {
  const payload: LiveEvent = { ...event, at: new Date().toISOString() };

  if (!config.redisUrl) {
    emitLocal(payload);
    return;
  }
  try {
    publisher ||= createRedisConnection();
    await publisher.publish(CHANNEL, JSON.stringify(payload));
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'Live event publish failed');
  }
}

function emitLocal(event: LiveEvent) {
  const deviceClients = clients.get(event.deviceId);
  if (deviceClients?.size) {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of deviceClients) client.write(payload);
  }

  const deviceSockets = sockets.get(event.deviceId);
  if (deviceSockets?.size) {
    const payload = JSON.stringify(event);
    for (const socket of deviceSockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }
}

function startRedisSubscriber() {
  if (subscriberStarted || !config.redisUrl) return;
  subscriberStarted = true;

  const subscriber = createRedisConnection();
  subscriber.subscribe(CHANNEL).catch((error) => {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'Live event subscribe failed');
  });
  subscriber.on('message', (_channel, message) => {
    try {
      emitLocal(JSON.parse(message) as LiveEvent);
    } catch {
      logger.warn({ message }, 'Invalid live event payload');
    }
  });
}
