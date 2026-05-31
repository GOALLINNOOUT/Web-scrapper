import { AlertEvent } from '../models/AlertEvent.js';
import { ChangeEvent } from '../models/ChangeEvent.js';
import { Page } from '../models/Page.js';
import { PageChange } from '../models/PageChange.js';
import { domainFromUrl } from '../utils/url.js';
import { decryptPageDocument, encryptChangePayload } from './changePayloadCrypto.js';

export async function detectPageChanges(input: {
  deviceId: string;
  workspaceId?: string;
  url: string;
  crawlId: string;
  contentHash: string;
}) {
  const previous = await Page.findOne(
    { deviceId: input.deviceId, url: input.url, crawlId: { $ne: input.crawlId }, status: 'crawled' },
    { contentHash: 1, metadata: 1, emails: 1, social: 1, techStack: 1, content: 1, score: 1 },
    { sort: { crawledAt: -1 } }
  ).lean();

  if (!previous) return [];

  const current = await Page.findOne(
    { deviceId: input.deviceId, url: input.url, crawlId: input.crawlId },
    { metadata: 1, emails: 1, social: 1, techStack: 1, content: 1, score: 1 }
  ).lean();

  if (!current) return [];
  const previousPage = decryptPageDocument(previous);
  const currentPage = decryptPageDocument(current);

  const changes: Array<{ type: string; severity: 'low' | 'medium' | 'high'; data?: Record<string, unknown>; oldValue?: unknown; newValue?: unknown; reason?: string }> = [];
  if (previous.contentHash !== input.contentHash) {
    const contentDiff = summarizeContentChange(previousPage.content?.text || '', currentPage.content?.text || '');
    changes.push({
      type: 'content_changed',
      severity: 'medium',
      data: contentDiff,
      oldValue: { excerpt: contentDiff.beforeExcerpt },
      newValue: { excerpt: contentDiff.afterExcerpt },
      reason: 'Page body content changed since the previous crawl.'
    });
  }

  const newEmails = (currentPage.emails || []).filter((email) => !(previousPage.emails || []).includes(email));
  if (newEmails.length > 0) changes.push({ type: 'new_email', severity: 'high', data: { emails: newEmails }, newValue: { emails: newEmails }, reason: 'New contact emails were discovered.' });

  const removedEmails = (previousPage.emails || []).filter((email) => !(currentPage.emails || []).includes(email));
  if (removedEmails.length > 0) changes.push({ type: 'removed_email', severity: 'medium', data: { emails: removedEmails }, oldValue: { emails: removedEmails }, reason: 'Previously discovered emails disappeared from the page.' });

  if (currentPage.metadata?.title !== previousPage.metadata?.title) {
    changes.push({
      type: 'metadata_changed',
      severity: 'low',
      data: { field: 'title', from: previousPage.metadata?.title, to: currentPage.metadata?.title },
      oldValue: { title: previousPage.metadata?.title },
      newValue: { title: currentPage.metadata?.title },
      reason: 'The page title changed.'
    });
  }

  const previousHeadings = previousPage.content?.headings || [];
  const currentHeadings = currentPage.content?.headings || [];
  if (JSON.stringify(previousHeadings) !== JSON.stringify(currentHeadings)) {
    changes.push({
      type: 'heading_changed',
      severity: 'medium',
      oldValue: { headings: previousHeadings.slice(0, 10) },
      newValue: { headings: currentHeadings.slice(0, 10) },
      reason: 'One or more page headings changed.'
    });
  }

  const priceChange = detectPriceChange(previousPage.content?.text || '', currentPage.content?.text || '');
  if (priceChange) {
    changes.push({
      type: 'price_changed',
      severity: 'high',
      data: priceChange,
      oldValue: { prices: priceChange.removed },
      newValue: { prices: priceChange.added },
      reason: 'Price-like text changed on a monitored page.'
    });
  }

  const socialChange = diffArrayValues(Object.values(previousPage.social || {}).flat().map(String), Object.values(currentPage.social || {}).flat().map(String));
  if (socialChange.added.length > 0 || socialChange.removed.length > 0) {
    changes.push({ type: 'social_changed', severity: 'medium', data: socialChange, oldValue: { social: socialChange.removed }, newValue: { social: socialChange.added }, reason: 'Social profiles changed.' });
  }

  const techChange = diffArrayValues((previousPage.techStack || []).map(String), (currentPage.techStack || []).map(String));
  if (techChange.added.length > 0 || techChange.removed.length > 0) {
    changes.push({ type: 'tech_stack_changed', severity: 'medium', data: techChange, oldValue: { techStack: techChange.removed }, newValue: { techStack: techChange.added }, reason: 'Technology signatures changed.' });
  }

  if (Math.abs((currentPage.score || 0) - (previousPage.score || 0)) >= 20) {
    changes.push({ type: 'score_changed', severity: 'medium', data: { from: previousPage.score || 0, to: currentPage.score || 0 }, oldValue: { score: previousPage.score || 0 }, newValue: { score: currentPage.score || 0 }, reason: 'The page importance score moved materially.' });
  }

  if (changes.length === 0) return [];

  const domain = domainFromUrl(input.url);
  await PageChange.insertMany(changes.map((change) => ({
    deviceId: input.deviceId,
    workspaceId: input.workspaceId || input.deviceId,
    url: input.url,
    domain,
    crawlId: input.crawlId,
    changeType: toLegacyChangeType(change.type),
    severity: change.severity,
    data: encryptChangePayload(change.data || {}),
    detectedAt: new Date()
  })), { ordered: false });

  await ChangeEvent.insertMany(changes.map((change) => ({
    deviceId: input.deviceId,
    workspaceId: input.workspaceId || input.deviceId,
    url: input.url,
    domain,
    crawlId: input.crawlId,
    eventType: change.type,
    severity: change.severity,
    oldValue: encryptChangePayload(change.oldValue || null),
    newValue: encryptChangePayload(change.newValue || null),
    diff: encryptChangePayload(change.data || {}),
    reason: change.reason || '',
    detectedAt: new Date()
  })), { ordered: false }).catch(() => undefined);

  const important = changes.filter((change) => change.severity === 'high' || change.severity === 'medium');
  if (important.length > 0) {
    await AlertEvent.create({
      deviceId: input.deviceId,
      type: 'change_detected',
      severity: important.some((change) => change.severity === 'high') ? 'high' : 'medium',
      domain,
      crawlId: input.crawlId,
      pageUrl: input.url,
      message: `${important.length} change${important.length === 1 ? '' : 's'} detected on ${domain}`,
      metadata: { changes: important }
    }).catch(() => undefined);
  }

  return changes;
}

function detectPriceChange(previousText: string, currentText: string) {
  const previous = extractPrices(previousText);
  const current = extractPrices(currentText);
  const diff = diffArrayValues(previous, current);
  return diff.added.length > 0 || diff.removed.length > 0 ? diff : null;
}

function summarizeContentChange(previousText: string, currentText: string) {
  const before = normalizeText(previousText);
  const after = normalizeText(currentText);
  const previousSentences = splitSentences(before);
  const currentSentences = splitSentences(after);
  const sentenceDiff = diffArrayValues(previousSentences, currentSentences);

  return {
    beforeExcerpt: excerptAroundDifference(before, sentenceDiff.removed[0] || ''),
    afterExcerpt: excerptAroundDifference(after, sentenceDiff.added[0] || ''),
    removedText: sentenceDiff.removed.slice(0, 5),
    addedText: sentenceDiff.added.slice(0, 5)
  };
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function splitSentences(value: string) {
  return value
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 24)
    .slice(0, 200);
}

function excerptAroundDifference(text: string, needle: string) {
  if (!text) return '';
  if (!needle) return text.slice(0, 500);
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return text.slice(0, 500);
  const start = Math.max(0, index - 180);
  const end = Math.min(text.length, index + needle.length + 180);
  return `${start > 0 ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`;
}

function extractPrices(text: string) {
  return [...new Set((text.match(/(?:[$€£₦]\s?\d[\d,.]*|\d[\d,.]*\s?(?:usd|eur|gbp|ngn|\/month|per month|monthly))/gi) || [])
    .map((value) => value.replace(/\s+/g, ' ').trim().toLowerCase()))];
}

function diffArrayValues(previous: string[], current: string[]) {
  const before = [...new Set(previous.filter(Boolean))];
  const after = [...new Set(current.filter(Boolean))];
  return {
    added: after.filter((value) => !before.includes(value)),
    removed: before.filter((value) => !after.includes(value))
  };
}

function toLegacyChangeType(type: string) {
  if (type === 'new_email' || type === 'removed_email') return 'new_emails';
  if (type === 'heading_changed' || type === 'price_changed' || type === 'social_changed' || type === 'tech_stack_changed') return 'content_changed';
  if (type === 'metadata_changed') return 'metadata_changed';
  if (type === 'score_changed') return 'score_changed';
  return 'content_changed';
}
