import type { NextFunction, Request, Response } from 'express';

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function inputSanitizer(req: Request, _res: Response, next: NextFunction) {
  if (req.body) req.body = sanitizeDeep(req.body);
  if (req.query) req.query = sanitizeDeep(req.query) as typeof req.query;
  if (req.params) req.params = sanitizeDeep(req.params) as typeof req.params;
  next();
}

export function sanitizeDeep(value: unknown, depth = 0): unknown {
  if (depth > 10) return {};
  if (typeof value === 'string') {
    return value
      .replace(/\0/g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim();
  }
  if (Array.isArray(value)) return value.slice(0, 1000).map((item) => sanitizeDeep(item, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const clean: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key.startsWith('$') || key.includes('.') || BLOCKED_KEYS.has(key)) continue;
      clean[key] = sanitizeDeep(item, depth + 1);
    }
    return clean;
  }
  return value;
}
