import http from 'node:http';

const url = new URL(process.env.BENCHMARK_URL || 'http://localhost:4000/health');
const requests = Number(process.env.BENCHMARK_REQUESTS || 1000);
const concurrency = Number(process.env.BENCHMARK_CONCURRENCY || 50);
let completed = 0;
let failed = 0;
let active = 0;
const startedAt = Date.now();

function runOne() {
  active += 1;
  const req = http.get(url, (res) => {
    res.resume();
    res.on('end', done);
  });
  req.on('error', () => {
    failed += 1;
    done();
  });
}

function done() {
  active -= 1;
  completed += 1;
  pump();
}

function pump() {
  while (active < concurrency && completed + active < requests) runOne();
  if (completed >= requests) {
    const seconds = (Date.now() - startedAt) / 1000;
    console.log(JSON.stringify({ requests, failed, seconds, requestsPerSecond: Math.round(requests / seconds) }, null, 2));
  }
}

pump();
