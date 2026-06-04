import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { AlertRecord } from '../models/AlertRecord.js';
import { FailureEvent } from '../models/FailureEvent.js';
import { MetricSnapshot } from '../models/MetricSnapshot.js';
import { QueueMetric } from '../models/QueueMetric.js';
import { WorkerMetric } from '../models/WorkerMetric.js';
import { config } from '../config/index.js';
import { getAdminMetricPayload } from '../routes/adminMetricsRoutes.js';
import { logger } from '../utils/logger.js';

type AdminRoom = 'live:overview' | 'live:infrastructure' | 'live:crawling' | 'live:failures' | 'live:alerts';

const pageRooms: Record<string, AdminRoom[]> = {
  overview: ['live:overview', 'live:alerts'],
  infrastructure: ['live:infrastructure'],
  crawling: ['live:crawling'],
  failures: ['live:failures'],
  alerts: ['live:alerts'],
  capacity: ['live:overview']
};

let io: SocketServer | null = null;
const lastEmitAt = new Map<string, number>();

export function attachAdminSocketServer(server: HttpServer) {
  if (io) return io;

  io = new SocketServer(server, {
    path: '/admin/socket.io',
    cors: {
      origin: config.clientOrigin,
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    socket.emit('connected', { ok: true });
    socket.on('subscribe', async (payload: { pages?: string[] } = {}) => {
      const rooms = new Set<AdminRoom>();
      for (const page of payload.pages || []) {
        for (const room of pageRooms[page] || []) rooms.add(room);
      }
      for (const room of rooms) socket.join(room);
      await sendInitialSnapshots(socket, rooms).catch((error) => {
        logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'Admin socket initial snapshot failed');
      });
    });
    socket.on('metrics:get', async (payload: { endpoint?: string; range?: string }, reply?: (response: unknown) => void) => {
      try {
        if (!payload?.endpoint) throw new Error('Missing metrics endpoint');
        const result = await getAdminMetricPayload(payload.endpoint, { range: payload.range });
        reply?.({ success: true, ...result });
      } catch (error) {
        reply?.({ success: false, error: { message: error instanceof Error ? error.message : 'Metrics request failed' } });
      }
    });
  });

  return io;
}

export function emitAdminRoom(room: AdminRoom, event: string, payload: unknown, throttleKey = event) {
  if (!io) return;
  const key = `${room}:${throttleKey}`;
  const now = Date.now();
  if ((lastEmitAt.get(key) || 0) > now - 1000) return;
  lastEmitAt.set(key, now);
  io.to(room).emit(event, payload);
}

export function emitAdminAlert(event: 'alerts:new' | 'alerts:resolve', payload: unknown) {
  emitAdminRoom('live:alerts', event, payload, event);
}

export function broadcastSystemHealth(payload: unknown) {
  if (!io) return;
  emitAdminRoom('live:overview', 'system:health', payload, 'system:health');
  emitAdminRoom('live:infrastructure', 'system:health', payload, 'system:health');
}

async function sendInitialSnapshots(socket: Parameters<SocketServer['on']>[1] extends (socket: infer S) => void ? S : never, rooms: Set<AdminRoom>) {
  if (rooms.has('live:overview')) {
    const [metric, queue, alerts] = await Promise.all([
      MetricSnapshot.findOne().sort({ timestamp: -1 }).lean(),
      QueueMetric.findOne().sort({ timestamp: -1 }).lean(),
      AlertRecord.find({ status: 'active' }).sort({ timestamp: -1 }).limit(50).lean()
    ]);
    socket.emit('metrics:live', { metric, queue, alerts });
    socket.emit('system:health', healthFromSnapshot(metric, queue));
  }
  if (rooms.has('live:infrastructure')) {
    const workers = await WorkerMetric.find().sort({ timestamp: -1 }).limit(25).lean();
    socket.emit('workers:live', workers);
  }
  if (rooms.has('live:failures')) {
    const failures = await FailureEvent.find().sort({ timestamp: -1 }).limit(50).lean();
    socket.emit('failures:live', failures);
  }
  if (rooms.has('live:alerts')) {
    const alerts = await AlertRecord.find({ status: 'active' }).sort({ timestamp: -1 }).limit(50).lean();
    socket.emit('alerts:active', alerts);
  }
}

function healthFromSnapshot(metric: any, queue: any) {
  if (!metric && !queue) {
    return { api: 'Offline', workers: 'Offline', redis: 'Offline', mongodb: 'Offline', proxy_pool: 'Offline', queue: 'Offline' };
  }
  return {
    api: statusFrom(metric?.api?.latency_p95 || 0, 500, 1000),
    workers: statusFrom(metric?.workers?.avg_cpu || 0, 85, 90),
    redis: statusFrom(metric?.redis?.maxmemory ? ((metric.redis?.memory_used || 0) / metric.redis.maxmemory) * 100 : 0, 75, 90),
    mongodb: statusFrom(metric?.mongodb?.latency_p95 || 0, 200, 500),
    proxy_pool: statusFromInverse(metric?.proxy_pool?.success_rate ?? 100, 85, 70),
    queue: statusFrom(queue?.backlog_growth_rate_per_min || 0, 50, 200)
  };
}

function statusFrom(value: number, warning: number, critical: number) {
  if (value >= critical) return 'Critical';
  if (value >= warning) return 'Warning';
  return 'Healthy';
}

function statusFromInverse(value: number, warning: number, critical: number) {
  if (value <= critical) return 'Critical';
  if (value <= warning) return 'Warning';
  return 'Healthy';
}
