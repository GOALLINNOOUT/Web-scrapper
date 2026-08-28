import mongoose from 'mongoose';
import { LEGACY_DEVICE_ID } from '../middleware/deviceScope.js';
import { CrawlJob } from '../models/CrawlJob.js';
import { Page } from '../models/Page.js';
import { MetricSnapshot } from '../models/MetricSnapshot.js';
import { QueueMetric } from '../models/QueueMetric.js';
import { WorkerMetric } from '../models/WorkerMetric.js';
import { DomainMetric } from '../models/DomainMetric.js';
import { FailureEvent } from '../models/FailureEvent.js';
import { AlertRecord } from '../models/AlertRecord.js';
import { CostMetric } from '../models/CostMetric.js';
import { AlertEvent } from '../models/AlertEvent.js';
import { ChangeEvent } from '../models/ChangeEvent.js';
import { CrawlSummary } from '../models/CrawlSummary.js';
import { DomainProfile } from '../models/DomainProfile.js';
import { MonitoringProfile } from '../models/MonitoringProfile.js';
import { config } from '../config/index.js';

export async function connectDatabase(uri?: string) {
  if (!uri) {
    throw new Error('MONGODB_URI is required');
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    ...(process.env.MONGODB_DB ? { dbName: process.env.MONGODB_DB } : {}),
    maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE || 100),
    minPoolSize: Number(process.env.MONGODB_MIN_POOL_SIZE || 10),
    socketTimeoutMS: 30_000,
    connectTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 5000,
    heartbeatFrequencyMS: 10_000,
    readPreference: 'secondaryPreferred'
  });
  await Promise.all([
    Page.syncIndexes().catch(() => undefined),
    CrawlJob.syncIndexes().catch(() => undefined),
    MetricSnapshot.syncIndexes().catch(() => undefined),
    QueueMetric.syncIndexes().catch(() => undefined),
    WorkerMetric.syncIndexes().catch(() => undefined),
    DomainMetric.syncIndexes().catch(() => undefined),
    FailureEvent.syncIndexes().catch(() => undefined),
    AlertRecord.syncIndexes().catch(() => undefined),
    CostMetric.syncIndexes().catch(() => undefined),
    AlertEvent.syncIndexes().catch(() => undefined),
    ChangeEvent.syncIndexes().catch(() => undefined),
    CrawlSummary.syncIndexes().catch(() => undefined),
    DomainProfile.syncIndexes().catch(() => undefined),
    MonitoringProfile.syncIndexes().catch(() => undefined)
  ]);
  await backfillLegacyDeviceIds();
}

async function backfillLegacyDeviceIds() {
  const expiresAt = new Date(Date.now() + config.dataRetentionDays * 24 * 60 * 60 * 1000);
  await Promise.all([
    CrawlJob.updateMany({ deviceId: { $exists: false } }, { $set: { deviceId: LEGACY_DEVICE_ID } }),
    Page.updateMany({ deviceId: { $exists: false } }, { $set: { deviceId: LEGACY_DEVICE_ID } }),
    CrawlJob.updateMany({ expiresAt: { $exists: false } }, { $set: { expiresAt } }),
    Page.updateMany({ expiresAt: { $exists: false } }, { $set: { expiresAt } })
  ]);
}
