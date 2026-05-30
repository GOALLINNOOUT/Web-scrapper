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
