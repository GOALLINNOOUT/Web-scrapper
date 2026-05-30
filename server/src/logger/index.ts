import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { fileURLToPath } from 'node:url';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogMeta = Record<string, unknown> | Error | string;

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, '..', '..', '..');
const logDirectory = process.env.LOG_DIR
  ? path.resolve(process.env.LOG_DIR)
  : path.join(projectRoot, 'logs');

let activeDate = '';
let activeStream: fs.WriteStream | null = null;

function write(level: LogLevel, meta?: LogMeta, message?: string) {
  const now = new Date();
  const msg = message || (typeof meta === 'string' ? meta : '');
  const details = normalizeMeta(meta);
  const record = {
    level,
    time: now.toISOString(),
    localTime: formatClockTimestamp(now),
    timezone: formatTimeZone(now),
    pid: process.pid,
    msg,
    ...details
  };

  const cliLine = formatCliLine(level, now, msg, details);
  const fileLine = `${JSON.stringify(record)}\n`;

  if (level === 'error') process.stderr.write(`${cliLine}\n`);
  else process.stdout.write(`${cliLine}\n`);

  getLogStream(now).write(fileLine);
}

function normalizeMeta(meta?: LogMeta) {
  if (!meta || typeof meta === 'string') return {};
  if (meta instanceof Error) {
    return {
      err: {
        name: meta.name,
        message: meta.message,
        stack: meta.stack
      }
    };
  }
  return redactSecrets(meta) as Record<string, unknown>;
}

function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1));
  if (!value || typeof value !== 'object') return value;

  const clean: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSecretKey(key)) clean[key] = '[REDACTED]';
    else clean[key] = redactSecrets(item, depth + 1);
  }
  return clean;
}

function isSecretKey(key: string) {
  return /password|token|api[-_]?key|secret|authorization|cookie/i.test(key);
}

function formatCliLine(level: LogLevel, date: Date, message: string, details: Record<string, unknown>) {
  const label = level.toUpperCase().padEnd(5);
  const time = formatClockTimestamp(date);
  const color = colorForLevel(level);
  const reset = '\x1b[0m';
  const dim = '\x1b[2m';
  const detailText = formatDetails(details);
  return `${dim}${time}${reset} ${color}${label}${reset} ${message || '(no message)'}${detailText ? ` ${dim}${detailText}${reset}` : ''}`;
}

function formatDetails(details: Record<string, unknown>) {
  const entries = Object.entries(details).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return '';
  return entries
    .map(([key, value]) => {
      if (key === 'err' && value && typeof value === 'object' && 'message' in value) {
        return `err=${JSON.stringify((value as { message?: string }).message || value)}`;
      }
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return `${key}=${value}`;
      return `${key}=${util.inspect(value, { depth: 2, breakLength: 80, colors: false })}`;
    })
    .join(' ');
}

function colorForLevel(level: LogLevel) {
  if (level === 'error') return '\x1b[31m';
  if (level === 'warn') return '\x1b[33m';
  if (level === 'info') return '\x1b[36m';
  return '\x1b[90m';
}

function formatClockTimestamp(date: Date) {
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  const millisecond = String(date.getMilliseconds()).padStart(3, '0');
  return `${hour}:${minute}:${second}.${millisecond} ${formatTimeZone(date)}`;
}

function formatTimeZone(date: Date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const hour = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minute = String(absolute % 60).padStart(2, '0');
  return `UTC${sign}${hour}:${minute}`;
}

function getLogStream(date: Date) {
  const dateKey = toDateKey(date);
  if (activeStream && activeDate === dateKey) return activeStream;

  if (activeStream) activeStream.end();
  fs.mkdirSync(logDirectory, { recursive: true });
  activeDate = dateKey;
  activeStream = fs.createWriteStream(path.join(logDirectory, `${dateKey}.log`), { flags: 'a' });
  return activeStream;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const logger = {
  debug: (meta?: LogMeta, message?: string) => write('debug', meta, message),
  info: (meta?: LogMeta, message?: string) => write('info', meta, message),
  warn: (meta?: LogMeta, message?: string) => write('warn', meta, message),
  error: (meta?: LogMeta, message?: string) => write('error', meta, message)
};
