#!/usr/bin/env node

const apiBase = process.env.API_BASE || process.env.VITE_API_BASE || 'http://127.0.0.1:8080';
const deviceId = process.env.DEVICE_ID || `worker-test-${Date.now()}`;
const timeoutMs = Number(process.env.WORKER_TEST_TIMEOUT_SECONDS || 90) * 1000;
const pollMs = Number(process.env.WORKER_TEST_POLL_MS || 2000);
const urls = (process.env.WORKER_TEST_URLS || 'https://example.com,https://www.iana.org/domains/reserved')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

async function main() {
  if (urls.length === 0) throw new Error('No URLs configured. Set WORKER_TEST_URLS.');

  console.log(`API: ${apiBase}`);
  console.log(`Device: ${deviceId}`);
  console.log(`Jobs: ${urls.length}`);
  console.log('');

  await assertHealthy();

  const jobs = await Promise.all(urls.map((url) => createCrawl(url)));
  for (const job of jobs) {
    console.log(`queued ${job._id} ${job.seedUrl}`);
  }
  console.log('');

  const finished = await waitForJobs(jobs.map((job) => job._id));
  for (const job of finished) {
    const results = await getResults(job._id);
    const count = Array.isArray(results.items) ? results.items.length : 0;
    const status = count > 0 ? 'OK' : 'NO_RESULTS';
    console.log(`${status} ${job._id} status=${job.status} pages=${job.pagesCrawled || 0} results=${count}`);
    if (job.error) console.log(`  error: ${job.error}`);
    if (count > 0) {
      const page = results.items[0];
      console.log(`  page: ${page.status} ${page.url}`);
    }
  }

  const failures = finished.filter((job) => job.status !== 'completed');
  const emptyResults = await Promise.all(finished.map(async (job) => {
    const results = await getResults(job._id);
    return !Array.isArray(results.items) || results.items.length === 0;
  }));

  if (failures.length > 0 || emptyResults.some(Boolean)) {
    throw new Error('One or more Rust worker jobs did not complete with results.');
  }

  console.log('');
  console.log('Rust worker smoke test passed.');
}

async function assertHealthy() {
  const response = await fetch(`${apiBase}/health`);
  if (!response.ok) throw new Error(`Load balancer health check failed: ${response.status}`);
  console.log(`load balancer health: ${await response.text()}`);
}

async function createCrawl(seedUrl) {
  const response = await fetch(`${apiBase}/crawl`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': deviceId
    },
    body: JSON.stringify({
      seedUrl,
      maxDepth: 0,
      maxPages: 1,
      sameDomainOnly: true,
      respectRobots: false,
      discovery: {
        sitemap: false,
        renderJavaScript: false,
        includeMetaLinks: false
      },
      extract: {
        links: true,
        emails: true,
        metadata: true,
        social: true,
        content: true
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create crawl for ${seedUrl}: ${response.status} ${body}`);
  }

  return response.json();
}

async function waitForJobs(ids) {
  const startedAt = Date.now();
  const pending = new Set(ids);
  const latest = new Map();

  while (pending.size > 0) {
    if (Date.now() - startedAt > timeoutMs) {
      const states = [...latest.values()].map((job) => `${job._id}:${job.status}`).join(', ');
      throw new Error(`Timed out waiting for worker jobs. Last states: ${states}`);
    }

    for (const id of [...pending]) {
      const job = await getJob(id);
      latest.set(id, job);
      process.stdout.write(`poll ${id}: ${job.status} pages=${job.pagesCrawled || 0}\n`);
      if (['completed', 'failed', 'stopped'].includes(job.status)) pending.delete(id);
    }

    if (pending.size > 0) await sleep(pollMs);
  }

  return ids.map((id) => latest.get(id));
}

async function getJob(id) {
  const response = await fetch(`${apiBase}/crawl/${id}`, {
    headers: { 'X-Device-Id': deviceId }
  });
  if (!response.ok) throw new Error(`Failed to read crawl ${id}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function getResults(id) {
  const response = await fetch(`${apiBase}/crawl/${id}/results?limit=5`, {
    headers: { 'X-Device-Id': deviceId }
  });
  if (!response.ok) throw new Error(`Failed to read results ${id}: ${response.status} ${await response.text()}`);
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
