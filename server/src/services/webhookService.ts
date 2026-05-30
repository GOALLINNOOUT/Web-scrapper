import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';

export function signWebhookPayload(payload: unknown, secret = process.env.WEBHOOK_SECRET || '') {
  return crypto.createHmac('sha256', secret || 'local-development-secret')
    .update(JSON.stringify(payload))
    .digest('hex');
}

export async function dispatchWebhook(input: { deviceId: string; event: string; payload: unknown }) {
  logger.info({ deviceId: input.deviceId, event: input.event }, 'Webhook dispatch queued/stubbed');
  return {
    delivered: false,
    signature: signWebhookPayload(input.payload),
    reason: 'No webhook endpoints are configured in Phase 1 local mode'
  };
}
