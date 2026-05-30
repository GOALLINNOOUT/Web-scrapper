import { AlertEvent } from '../models/AlertEvent.js';
import { Page } from '../models/Page.js';
import { PageChange } from '../models/PageChange.js';
import { domainFromUrl } from '../utils/url.js';

export async function detectPageChanges(input: {
  deviceId: string;
  workspaceId?: string;
  url: string;
  crawlId: string;
  contentHash: string;
}) {
  const previous = await Page.findOne(
    { deviceId: input.deviceId, url: input.url, crawlId: { $ne: input.crawlId }, status: 'crawled' },
    { contentHash: 1, metadata: 1, emails: 1, score: 1 },
    { sort: { crawledAt: -1 } }
  ).lean();

  if (!previous) return [];

  const current = await Page.findOne(
    { deviceId: input.deviceId, url: input.url, crawlId: input.crawlId },
    { metadata: 1, emails: 1, score: 1 }
  ).lean();

  if (!current) return [];

  const changes: Array<{ type: 'content_changed' | 'new_emails' | 'metadata_changed' | 'score_changed'; severity: 'low' | 'medium' | 'high'; data?: Record<string, unknown> }> = [];
  if (previous.contentHash !== input.contentHash) changes.push({ type: 'content_changed', severity: 'medium' });

  const newEmails = (current.emails || []).filter((email) => !(previous.emails || []).includes(email));
  if (newEmails.length > 0) changes.push({ type: 'new_emails', severity: 'high', data: { emails: newEmails } });

  if (current.metadata?.title !== previous.metadata?.title) {
    changes.push({
      type: 'metadata_changed',
      severity: 'low',
      data: { field: 'title', from: previous.metadata?.title, to: current.metadata?.title }
    });
  }

  if (Math.abs((current.score || 0) - (previous.score || 0)) >= 20) {
    changes.push({ type: 'score_changed', severity: 'medium', data: { from: previous.score || 0, to: current.score || 0 } });
  }

  if (changes.length === 0) return [];

  const domain = domainFromUrl(input.url);
  await PageChange.insertMany(changes.map((change) => ({
    deviceId: input.deviceId,
    workspaceId: input.workspaceId || input.deviceId,
    url: input.url,
    domain,
    crawlId: input.crawlId,
    changeType: change.type,
    severity: change.severity,
    data: change.data || {},
    detectedAt: new Date()
  })), { ordered: false });

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
