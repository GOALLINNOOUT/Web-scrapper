import { WorkspaceSettings } from '../models/WorkspaceSettings.js';

export const defaultWorkspaceSettings = {
  account: { name: '', email: '', profileImage: '' },
  workspace: { name: 'Local workspace', logo: '' },
  notifications: {
    inApp: 'important',
    email: 'disabled',
    events: {
      pricingChanges: true,
      emailDiscoveries: true,
      dnsChanges: true,
      whoisChanges: true,
      techStackChanges: true,
      newPages: true
    }
  },
  crawling: {
    defaultDepth: 2,
    maxPages: 500,
    respectRobots: false,
    crawlDelaySeconds: 1,
    userAgentMode: 'default',
    customUserAgent: ''
  },
  monitoring: {
    preset: 'competitive_intelligence',
    defaultFrequency: 'daily',
    autoMonitorImportantPages: true,
    sensitivity: 'medium'
  },
  dataRetention: {
    retentionDays: 90,
    autoDelete: true,
    exportFormat: 'json'
  },
  integrations: {
    webhookUrl: '',
    webhookSecret: '',
    webhookEvents: ['change_detected', 'new_email']
  },
  appearance: {
    theme: 'system',
    density: 'comfortable'
  }
};

export async function getWorkspaceSettings(deviceId: string) {
  const existing = await WorkspaceSettings.findOne({ deviceId }).lean();
  if (existing) return mergeSettings(defaultWorkspaceSettings, existing);

  const created = await WorkspaceSettings.create({
    deviceId,
    workspaceId: deviceId,
    ...defaultWorkspaceSettings
  });
  return mergeSettings(defaultWorkspaceSettings, created.toObject());
}

export async function updateWorkspaceSettings(deviceId: string, patch: Record<string, unknown>) {
  const sanitized = sanitizeSettingsPatch(patch);
  const current = await getWorkspaceSettings(deviceId);
  const next = mergeSettings(current, sanitized);
  const updated = await WorkspaceSettings.findOneAndUpdate(
    { deviceId },
    { $set: { ...next, deviceId, workspaceId: deviceId } },
    { upsert: true, new: true }
  ).lean();
  return mergeSettings(defaultWorkspaceSettings, updated || next);
}

export function mergeSettings<T extends Record<string, unknown>>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object') return base;
  const output: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (['_id', '__v', 'deviceId', 'workspaceId', 'createdAt', 'updatedAt'].includes(key)) continue;
    const current = output[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      output[key] = mergeSettings(current as Record<string, unknown>, value);
    } else if (value !== undefined) {
      output[key] = value;
    }
  }
  return output as T;
}

function sanitizeSettingsPatch(patch: Record<string, unknown>) {
  const allowed = new Set(Object.keys(defaultWorkspaceSettings));
  return Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.has(key)));
}

function isPlainObject(value: unknown) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}
