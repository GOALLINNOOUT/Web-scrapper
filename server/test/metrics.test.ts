import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMongoStorageMetrics } from '../src/services/metricsCollector.js';

const MB = 1024 * 1024;

test('builds Atlas-like Mongo storage metrics while preserving logical data size', () => {
  const metrics = buildMongoStorageMetrics({
    dataSize: 3.9 * MB,
    storageSize: 400 * MB,
    indexSize: 29.2 * MB
  }, 512);

  assert.equal(metrics.storage_used_mb, 429.2);
  assert.equal(metrics.storage_total_mb, 512);
  assert.equal(metrics.storage_free_mb, 82.8);
  assert.equal(metrics.storage_used_percent, 83.83);
  assert.equal(metrics.logical_data_mb, 3.9);
});

test('builds zero Mongo storage metrics when db stats are unavailable', () => {
  const metrics = buildMongoStorageMetrics(null, 512);

  assert.equal(metrics.storage_used_mb, 0);
  assert.equal(metrics.storage_total_mb, 512);
  assert.equal(metrics.storage_free_mb, 512);
  assert.equal(metrics.storage_used_percent, 0);
  assert.equal(metrics.logical_data_mb, 0);
});
