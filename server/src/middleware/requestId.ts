import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('X-Request-ID') || req.header('X-Correlation-ID');
  req.requestId = incoming && validRequestId(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
}

function validRequestId(value?: string) {
  return Boolean(value && /^[a-zA-Z0-9._:-]{8,128}$/.test(value));
}
