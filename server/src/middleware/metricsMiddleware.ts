import type { NextFunction, Request, Response } from 'express';
import { observeHistogram } from '../utils/metrics.js';

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const elapsedSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
    observeHistogram('webintel_api_latency_seconds', 'API endpoint latency in seconds', elapsedSeconds, {
      method: req.method,
      route: routeLabel(req),
      status_code: res.statusCode
    });
  });
  next();
}

function routeLabel(req: Request) {
  const first = req.path.split('/').filter(Boolean)[0] || 'root';
  return `/${first}`;
}
