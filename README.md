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
- Redis: set `REDIS_URL` to enable BullMQ page-level crawl workers, rate limiting, robots cache, retries, and dead-letter retention.
- MongoDB: models include compound indexes for device/workspace, domain, classification, score, tech stack, crawl time, and contact discovery.
- Security: crawl targets pass DNS-backed SSRF checks before network fetches; private/local targets are rejected.

## 50 Pages/Second Profile

The production defaults target 50 completed pages per second globally across worker containers:

```bash
PERFORMANCE_MODE=production
REDIS_URL=redis://...
TARGET_CRAWL_PAGES_PER_SECOND=50
CRAWL_PAGE_WORKER_RATE=50
CRAWL_PAGE_WORKER_CONCURRENCY=200
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

Watch `/metrics` for `webintel_pages_crawled_total`, `webintel_page_fetch_mode_total`, `webintel_fetch_duration_seconds`, `webintel_render_duration_seconds`, `webintel_render_queue_depth`, `webintel_render_active`, `webintel_domain_throttle_wait_seconds`, and `webintel_queue_depth` while tuning workers.

Docker and Nginx assets live in `docker/` and `nginx/`.

## Environment

Create `server/.env`:

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/web_intelligence
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
```

Optional crawler identity rotation is configured with `CRAWLER_USER_AGENT_POOL` and `CRAWLER_PROXY_URLS`.
Only operator-supplied HTTP/HTTPS proxies are used; TLS handshakes remain the standard Node.js/Playwright behavior.

## API

- `POST /crawl` creates and starts a crawl job.
- `GET /crawl/:id` returns crawl job status and counters.
- `GET /crawl/:id/results` returns pages for one crawl.
- `POST /crawl/:id/stop` requests a running crawl to stop.
- `GET /data` returns extracted pages with filters.
