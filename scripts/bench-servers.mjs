#!/usr/bin/env node

import http from 'node:http';
import { performance } from 'node:perf_hooks';

const targets = [
  ['api-1', process.env.API_1_URL || 'http://127.0.0.1:4001/health'],
  ['api-2', process.env.API_2_URL || 'http://127.0.0.1:4002/health'],
  ['load-balancer', process.env.LB_URL || 'http://127.0.0.1:8080/health']
];

const durationMs = Number(process.env.BENCH_DURATION_SECONDS || 60) * 1000;
const concurrency = Number(process.env.BENCH_CONCURRENCY || 25);
const timeoutMs = Number(process.env.BENCH_TIMEOUT_MS || 5000);

async function main() {
  console.log(`Duration: ${durationMs / 1000}s`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Timeout: ${timeoutMs}ms`);
  console.log('');

  for (const [name, url] of targets) {
    const result = await benchmark(name, url);
    printResult(result);
  }
}

async function benchmark(name, url) {
  let ok = 0;
  let failed = 0;
  let inFlight = 0;
  let launched = 0;
  const latencies = [];
  const startedAt = performance.now();
  const endAt = startedAt + durationMs;

  return await new Promise((resolve) => {
    function launchMore() {
      while (inFlight < concurrency && performance.now() < endAt) {
        inFlight += 1;
        launched += 1;
        const requestStartedAt = performance.now();
        request(url, timeoutMs)
          .then((status) => {
            const latency = performance.now() - requestStartedAt;
            latencies.push(latency);
            if (status >= 200 && status < 300) ok += 1;
            else failed += 1;
          })
          .catch(() => {
            failed += 1;
          })
          .finally(() => {
            inFlight -= 1;
            if (performance.now() >= endAt && inFlight === 0) {
              const elapsedMs = performance.now() - startedAt;
              resolve({ name, url, ok, failed, launched, latencies, elapsedMs });
            } else {
              launchMore();
            }
          });
      }

      if (performance.now() >= endAt && inFlight === 0) {
        const elapsedMs = performance.now() - startedAt;
        resolve({ name, url, ok, failed, launched, latencies, elapsedMs });
      }
    }

    launchMore();
  });
}

function request(url, timeout) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode || 0));
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

function printResult(result) {
  const sorted = [...result.latencies].sort((a, b) => a - b);
  const total = result.ok + result.failed;
  const perMinute = (result.ok / result.elapsedMs) * 60_000;
  const errorRate = total === 0 ? 0 : (result.failed / total) * 100;

  console.log(`${result.name} (${result.url})`);
  console.log(`  ok: ${result.ok}`);
  console.log(`  failed: ${result.failed}`);
  console.log(`  ok/min: ${Math.round(perMinute)}`);
  console.log(`  error rate: ${errorRate.toFixed(2)}%`);
  console.log(`  latency p50: ${percentile(sorted, 50).toFixed(1)}ms`);
  console.log(`  latency p95: ${percentile(sorted, 95).toFixed(1)}ms`);
  console.log(`  latency p99: ${percentile(sorted, 99).toFixed(1)}ms`);
  console.log('');
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
