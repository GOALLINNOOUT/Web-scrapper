# Recursive Web Intelligence Crawler

A Node.js + React web intelligence system for recursive crawling, email/social discovery, SEO metadata extraction, and dashboard exploration.

## Quick Start

```bash
npm install
cp .env.example server/.env
npm run dev:server
npm run dev:client
```

The API runs on `http://localhost:4000` and the dashboard runs on `http://localhost:5173`.

## Production Shape

- API: clustered Express process. Set `NODE_ENV=production` and `WEB_WORKERS` to fork API workers.
- Workers: run `npm run dev:worker` locally or `npm run start:worker --workspace server` in production.
- Redis: set `REDIS_URL` to enable BullMQ page-level crawl workers, scheduled monitoring checks, rate limiting, robots cache, retries, and dead-letter retention.
- MongoDB: models include compound indexes for device/workspace, domain, classification, score, tech stack, crawl time, and contact discovery.
- Security: crawl targets pass DNS-backed SSRF checks before network fetches; private/local targets are rejected.
- Edge: use your hosting provider's generated HTTPS API URL. The React frontend can stay on Vercel Free without a custom domain.

## Vercel Free Deployment

Use Vercel for the React frontend and a separate HTTPS-capable host for the API. Do not put crawl workers on Vercel; they are long-running BullMQ consumers.

```text
Vercel frontend: https://your-app.vercel.app
        |
API host URL: https://your-api-host.example
        |
Shared Redis + MongoDB
        |
Worker server 1 -> worker container
Worker server 2 -> worker container
```

Set the frontend API URL in Vercel to the generated HTTPS URL from your API host:

```bash
VITE_API_URL=https://your-api-host.example
```

Set the API CORS origin to your Vercel app:

```bash
CLIENT_ORIGIN=https://your-app.vercel.app
START_WORKERS_IN_API=false
CRAWLER_RESPECT_ROBOTS=false
```

Run API and worker containers as separate services. On the API host:

```bash
docker compose -f docker/docker-compose.api.yml up -d --build
```

On each worker-only server:

```bash
docker compose -f docker/docker-compose.worker.yml up -d --build
```

Workers do not need a load balancer or public port. To add capacity, start the same worker compose file on another server with the same `REDIS_URL` and `MONGODB_URI`.

Workers do not need a load balancer or public port. To add capacity, start the same worker compose file on another server with the same `REDIS_URL` and `MONGODB_URI`.

For a single-host smoke test with local Redis:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

If you do not own a domain, avoid a plain `http://server-ip:4000` API for the Vercel frontend because browsers will block mixed-content calls from HTTPS pages. Use a host that gives the API an HTTPS URL, such as Render, Fly.io, Railway, or another HTTPS-capable platform.

## 50 Pages/Second Profile

The production defaults target 50 completed pages per second globally across worker containers:

```bash
PERFORMANCE_MODE=production
REDIS_URL=redis://...
TARGET_CRAWL_PAGES_PER_SECOND=50
CRAWL_PAGE_WORKER_RATE=50
CRAWL_PAGE_WORKER_CONCURRENCY=200
MONITORING_CHECKS_CONCURRENCY=4
MONITORING_SCHEDULER_INTERVAL_MS=60000
HTTP_AGENT_MAX_SOCKETS=200
CRAWLER_DOMAIN_RATE_PER_SECOND=5
CRAWLER_DOMAIN_CONCURRENCY=4
```

The global rate is intentionally separate from per-domain politeness. A single site will not reach 50 pages/sec unless `CRAWLER_DOMAIN_RATE_PER_SECOND` and `CRAWLER_DOMAIN_CONCURRENCY` are raised for a target you own or have permission to crawl.

JavaScript rendering remains a fallback path. HTTP fetches run first, and Playwright is used only when static HTML does not expose enough links. Keep render capacity bounded so heavy sites cannot starve normal page workers:

```bash
CRAWLER_RENDER_CONCURRENCY=4
CRAWLER_RENDER_RATE=10
CRAWLER_RENDER_TIMEOUT_MS=15000
CRAWLER_RENDER_QUEUE_MAX=500
CRAWLER_BLOCK_RENDER_ASSETS=true
```

Set `MONITORING_ENCRYPTION_KEY` to encrypt monitoring before/after/diff payloads and stored page text snapshots in MongoDB while still letting the API decrypt them for the dashboard:

```bash
MONITORING_ENCRYPTION_KEY=base64-encoded-32-byte-key
```

Generate a key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

When this key is set, `Page.content.text` is stored as AES-256-GCM ciphertext. The crawler still stores `contentHash`, URL, domain, metadata, headings, emails, links, social profiles, tech stack, and scores as normal fields. Body-text search is disabled for newly encrypted page text because raw body text is no longer copied into `searchText`.

Watch `/metrics` for `webintel_pages_crawled_total`, `webintel_page_fetch_mode_total`, `webintel_fetch_duration_seconds`, `webintel_render_duration_seconds`, `webintel_render_queue_depth`, `webintel_render_active`, `webintel_domain_throttle_wait_seconds`, and `webintel_queue_depth` while tuning workers.

## Scheduled Monitoring

Manual crawls and monitoring checks are intentionally separate:

- Manual crawl: user starts a crawl from Overview/Crawls. It can discover links, follow depth, use sitemaps, and expand into many pages.
- Monitoring profile: user adds a domain and accepts recommended pages. The profile stores enabled monitored URLs and a schedule: `12h`, `daily`, `weekly`, or `monthly`.
- Scheduler: worker processes scan due profiles every `MONITORING_SCHEDULER_INTERVAL_MS` and enqueue `monitoring-checks` jobs in BullMQ.
- Monitoring check: the worker creates a crawl job for only the monitored URLs, with `maxDepth: 0` and sitemap discovery disabled. This revisits known important pages without doing a full crawl.
- Change detection: normal page workers fetch those URLs and compare against previous crawls, then write `ChangeEvent` records for Monitoring.

This means daily/weekly/monthly monitoring keeps running independently of manual crawling as long as at least one worker process is running with `REDIS_URL` and `MONGODB_URI`.

Docker deployment assets live in `docker/`.

## Environment

Create `server/.env`:

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/web_intelligence
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
```

Optional crawler identity rotation is configured with `CRAWLER_USER_AGENT_POOL` and `CRAWLER_PROXY_URLS`.
Only operator-supplied HTTP/HTTPS proxies are used; TLS handshakes remain the standard Node.js/Playwright behavior.
Robots.txt is ignored by default; set `CRAWLER_RESPECT_ROBOTS=true` only when you want the crawler to fetch/cache robots.txt and skip disallowed paths.

## API

- `POST /crawl` creates and starts a crawl job.
- `GET /crawl/:id` returns crawl job status and counters.
- `GET /crawl/:id/results` returns pages for one crawl.
- `POST /crawl/:id/stop` requests a running crawl to stop.
- `GET /data` returns extracted pages with filters.
