import type { NextFunction, Request, Response } from 'express';

const DEVICE_ID_RE = /^[a-zA-Z0-9._:-]{8,96}$/;

declare global {
  namespace Express {
    interface Request {
      deviceId: string;
    }
  }
}

export const LEGACY_DEVICE_ID = 'legacy-local-device';

export function deviceScope(req: Request, res: Response, next: NextFunction) {
  const rawDeviceId = req.header('X-Device-Id') || (typeof req.query.deviceId === 'string' ? req.query.deviceId : '');
  const deviceId = rawDeviceId?.trim();

  if (!deviceId || !DEVICE_ID_RE.test(deviceId)) {
    return res.status(400).json({
      error: 'INVALID_WORKSPACE',
      message: 'A valid X-Device-Id header is required for local workspace isolation.'
    });
  }

  req.deviceId = deviceId;
  next();
}
