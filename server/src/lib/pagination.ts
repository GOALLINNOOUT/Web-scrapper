import mongoose from 'mongoose';

interface CursorPayload {
  crawledAt: string;
  id: string;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export function parseLimit(value: unknown, fallback = 25, max = 100) {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

export function encodeCursor(doc?: { _id?: unknown; crawledAt?: Date | string } | null) {
  if (!doc?._id || !doc.crawledAt) return null;

  const payload: CursorPayload = {
    id: String(doc._id),
    crawledAt: new Date(doc.crawledAt).toISOString()
  };

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(rawCursor: unknown) {
  const cursor = Array.isArray(rawCursor) ? rawCursor[0] : rawCursor;
  if (!cursor) return null;

  try {
    const payload = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8')) as CursorPayload;
    if (!payload.crawledAt || !mongoose.Types.ObjectId.isValid(payload.id)) return null;

    return {
      crawledAt: new Date(payload.crawledAt),
      id: new mongoose.Types.ObjectId(payload.id)
    };
  } catch {
    return null;
  }
}

export function cursorFilter(rawCursor: unknown) {
  const cursor = decodeCursor(rawCursor);
  if (!cursor) return null;

  return {
    $or: [
      { crawledAt: { $lt: cursor.crawledAt } },
      { crawledAt: cursor.crawledAt, _id: { $lt: cursor.id } }
    ]
  };
}

export function toCursorPage<T extends { _id?: unknown; crawledAt?: Date | string }>(items: T[], limit: number): CursorPage<T> {
  const hasMore = items.length > limit;
  const visibleItems = hasMore ? items.slice(0, limit) : items;
  return {
    items: visibleItems,
    nextCursor: hasMore ? encodeCursor(visibleItems.at(-1)) : null
  };
}
