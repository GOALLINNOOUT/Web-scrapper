import express from 'express';
import cors from 'cors';
import type { ErrorRequestHandler } from 'express';
import { crawlRouter } from './routes/crawlRoutes.js';
import { dataRouter } from './routes/dataRoutes.js';
import { metadataRouter } from './routes/metadataRoutes.js';
import { domainRouter } from './routes/domainRoutes.js';
import { alertsRouter, monitoringRouter } from './routes/monitoringRoutes.js';
import { settingsRouter } from './routes/settingsRoutes.js';
import { liveRouter } from './routes/liveRoutes.js';
import { deviceScope } from './middleware/deviceScope.js';
import type { CrawlManager } from './crawler/CrawlManager.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { ssrfProtection } from './middleware/ssrfProtection.js';
import { requestId } from './middleware/requestId.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { inputSanitizer } from './middleware/inputSanitizer.js';
import { metricsMiddleware } from './middleware/metricsMiddleware.js';
import { logger } from './utils/logger.js';
import { config } from './config/index.js';
import { renderMetrics } from './utils/metrics.js';
import { redisConnection } from './queue/connection.js';
import mongoose from 'mongoose';

interface CreateAppOptions {
  crawlManager: CrawlManager;
}

interface HttpError extends Error {
  status?: number;
}

export function createApp({ crawlManager }: CreateAppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use(cors({
    origin: parseAllowedOrigins(config.clientOrigin)
  }));
  app.use(securityHeaders);
  app.use(requestId);
  app.use(metricsMiddleware);
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(inputSanitizer);

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/ready', async (_req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) throw new Error('MongoDB not ready');
      if (config.redisUrl) await redisConnection().ping();
      else if (config.performanceMode === 'production') throw new Error('Redis not configured');
      res.json({ ok: true });
    } catch (error) {
      res.status(503).json({ ok: false, message: error instanceof Error ? error.message : 'Service not ready' });
    }
  });
  app.get('/metrics', (_req, res) => {
    res.type('text/plain; version=0.0.4; charset=utf-8').send(renderMetrics());
  });

  app.use(deviceScope);
  app.use(rateLimiter);
  app.use('/crawl', ssrfProtection);
  app.use('/crawl', crawlRouter({ crawlManager }));
  app.use('/data', dataRouter());
  app.use('/results', dataRouter());
  app.use('/search', dataRouter());
  app.use('/domain', domainRouter());
  app.use('/monitoring', ssrfProtection);
  app.use('/monitoring', monitoringRouter({ crawlManager }));
  app.use('/alerts', alertsRouter());
  app.use('/settings', settingsRouter());
  app.use('/metadata', metadataRouter());
  app.use('/events', liveRouter());

  const errorHandler: ErrorRequestHandler = (err: HttpError, _req, res, _next) => {
    const status = err.status || 500;
    const isExpectedClientError = status >= 400 && status < 500;
    if (isExpectedClientError) {
      logger.warn({ status, err: err.message }, 'Request rejected');
    } else {
      logger.error(err, 'Unhandled request error');
    }
    res.status(status).json({
      error: status < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
      message: err.message || 'Internal server error'
    });
  };

  app.use(errorHandler);

  return app;
}

function parseAllowedOrigins(value: string) {
  const origins = value
    .split(/[\n,|]+/)
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

  return origins.length <= 1 ? origins[0] || false : origins;
}
