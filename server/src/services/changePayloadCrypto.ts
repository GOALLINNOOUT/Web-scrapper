import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { decompress } from 'fzstd';

const algorithm = 'aes-256-gcm';
const envelopeVersion = 1;

interface EncryptedEnvelope {
  __encrypted: true;
  v: number;
  alg: typeof algorithm;
  iv: string;
  tag: string;
  data: string;
}

export function encryptChangePayload<T>(value: T): T | EncryptedEnvelope {
  const key = getEncryptionKey();
  if (!key || value === undefined || value === null) return value;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    __encrypted: true,
    v: envelopeVersion,
    alg: algorithm,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64')
  };
}

export function decryptChangePayload<T = unknown>(value: T): T {
  if (!isEncryptedEnvelope(value)) return value;
  const key = getEncryptionKey();
  if (!key) return { decryptionUnavailable: true } as T;

  try {
    const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(value.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(value.data, 'base64')),
      decipher.final()
    ]);
    return JSON.parse(decrypted.toString('utf8')) as T;
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'Unable to decrypt monitoring change payload');
    return { decryptionFailed: true } as T;
  }
}

export function decryptChangeEvent<T extends { oldValue?: unknown; newValue?: unknown; diff?: unknown; data?: unknown }>(event: T): T {
  return {
    ...event,
    oldValue: decryptChangePayload(event.oldValue),
    newValue: decryptChangePayload(event.newValue),
    diff: decryptChangePayload(event.diff),
    data: decryptChangePayload(event.data)
  };
}

export function shouldEncryptStoredPageText() {
  return Boolean(config.monitoringEncryptionKey);
}

export function encryptStoredPageText(value: string) {
  const key = getEncryptionKey();
  if (!key || !value) return value;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(value, 'utf8')), cipher.final()]);
  return [
    'enc',
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url')
  ].join(':');
}

export function decryptStoredPageText(value: string) {
  if (!isEncryptedText(value)) return value;
  const key = getEncryptionKey();
  if (!key) return '';

  try {
    const [, , iv, tag, data] = value.split(':');
    const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'Unable to decrypt stored page text');
    return '';
  }
}

export function encryptPageContent<T extends { text?: string }>(content: T): T {
  if (!content?.text) return content;
  return { ...content, text: encryptStoredPageText(content.text) };
}

export function decryptPageContent<T extends { text?: string }>(content: T): T {
  if (!content?.text) return content;
  return { ...content, text: decryptStoredPageText(content.text) };
}

export function decryptPageDocument<T extends { content?: { text?: string }; compressionAlgorithm?: string | null; compressedContent?: any }>(page: T): T {
  let finalPage = { ...page };
  if (finalPage.compressionAlgorithm === 'zstd' && finalPage.compressedContent) {
    try {
      const buffer = Buffer.isBuffer(finalPage.compressedContent)
        ? finalPage.compressedContent
        : (finalPage.compressedContent.buffer || Buffer.from(finalPage.compressedContent));
      const decompressed = decompress(buffer);
      const decompressedStr = Buffer.from(decompressed).toString('utf8');
      finalPage.content = JSON.parse(decompressedStr);
    } catch (error) {
      logger.error({ err: error instanceof Error ? error.message : String(error) }, 'Failed to decompress page content');
    }
  }
  if (!finalPage.content) return finalPage;
  return { ...finalPage, content: decryptPageContent(finalPage.content) };
}

function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  return Boolean(
    value
      && typeof value === 'object'
      && (value as Record<string, unknown>).__encrypted === true
      && (value as Record<string, unknown>).alg === algorithm
  );
}

function isEncryptedText(value: string) {
  return value.startsWith('enc:v1:');
}

function getEncryptionKey() {
  if (!config.monitoringEncryptionKey) return null;

  const raw = config.monitoringEncryptionKey.trim();
  const key = decodeKey(raw);
  if (key.length === 32) return key;

  return crypto.createHash('sha256').update(raw).digest();
}

function decodeKey(value: string) {
  if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  try {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall through to utf8 handling.
  }
  return Buffer.from(value, 'utf8');
}
