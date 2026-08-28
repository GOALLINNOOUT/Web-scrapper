# Web Intelligence Crawler

This repo is now organized around the deployment shape in your diagram:

```text
Internet
  |
Rust Load Balancer
  |
  +-- TypeScript API 1 --+
  |                      |
  +-- TypeScript API 2 --+-- Shared Redis -- MongoDB Atlas
                         |
       Rust Worker 1 ----+
       Rust Worker 2 ----+
```

The public entrypoint is the load balancer. The two API containers do not need public ports. The two Rust workers do not need public ports.

The React client defaults to the local load balancer at `http://localhost:8080`.

## Start The Full Local Cluster

From the repo root:

```powershell
docker compose -f docker/docker-compose.yml up -d --build
```

This starts:

```text
load-balancer   http://localhost:8080
api-1           internal http://api-1:4000
api-2           internal http://api-2:4000
rust-worker-1   listens to Redis queue webscrapper:jobs
rust-worker-2   listens to Redis queue webscrapper:jobs
redis           local Redis on 127.0.0.1:6379
```

Your `.env` must contain `MONGODB_URI`. The current `.env` already has one.

## Test The Cluster

```powershell
curl.exe http://localhost:8080/health
curl.exe http://localhost:8080/ready
docker compose -f docker/docker-compose.yml ps
docker compose -f docker/docker-compose.yml logs -f load-balancer
```

Run the failover test:

```powershell
npm.cmd run test:lb
```

The failover test stops `api-1`, waits for the Rust load balancer health check, sends requests through `http://localhost:8080`, then starts `api-1` again.

Run the Rust worker smoke test:

```powershell
npm.cmd run test:workers
```

The worker test submits two one-page crawl jobs through the load balancer and waits for the Rust workers to complete them. It uses a small amount of internet by default because the workers fetch `https://example.com` and `https://www.iana.org/domains/reserved`.

Use your own test URLs:

```powershell
$env:WORKER_TEST_URLS="https://example.com,https://www.iana.org/domains/reserved"
npm.cmd run test:workers
```

Run the WebSocket smoke test:

```powershell
npm.cmd run test:ws
```

This verifies both live socket paths through the load balancer:

```text
/events
/admin/socket.io
```

If Docker cannot rebuild the load balancer image, run the fixed Rust load balancer locally:

```powershell
cargo build -p load-balancer --release
npm.cmd run start:lb:local
```

Stop the local load balancer:

```powershell
npm.cmd run stop:lb:local
```

Benchmark local request capacity:

```powershell
npm.cmd run bench:servers
```

The benchmark calls local `/health` endpoints only:

```text
api-1         http://127.0.0.1:4001/health
api-2         http://127.0.0.1:4002/health
load-balancer http://127.0.0.1:8080/health
```

Tune duration and concurrency:

```powershell
$env:BENCH_DURATION_SECONDS="60"
$env:BENCH_CONCURRENCY="50"
npm.cmd run bench:servers
```

Create a crawl through the load balancer:

```powershell
curl.exe -X POST http://localhost:8080/crawl `
  -H "Content-Type: application/json" `
  -d "{\"seedUrl\":\"https://example.com\",\"maxDepth\":0,\"maxPages\":1}"
```

Then watch workers:

```powershell
docker compose -f docker/docker-compose.yml logs -f rust-worker-1 rust-worker-2
```

## Stop Everything

```powershell
docker compose -f docker/docker-compose.yml down
```

## Local Development Without Docker

Use this only when editing the API/client:

```powershell
npm.cmd run dev:server
npm.cmd run dev:client
```

If you want the client to call a different API URL:

```powershell
$env:VITE_API_BASE="http://localhost:8080"
npm.cmd run dev:client
```

Use this when testing Rust locally:

```powershell
$env:REDIS_URL="redis://127.0.0.1:6379"
$env:MONGODB_URI="your MongoDB URI"
cargo run -p worker
```

Run the load balancer locally:

```powershell
$env:PORT="8080"
$env:BACKENDS="http://127.0.0.1:4000,http://127.0.0.1:4001"
cargo run -p load-balancer
```

## Verify Code

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
cargo test
```

## Render Setup

`render.yaml` defines:

```text
1 Redis service
1 Rust load balancer web service
2 TypeScript API web services
2 Rust worker services
```

After Render creates `web-intel-api-1` and `web-intel-api-2`, set the load balancer `BACKENDS` env var to the two API URLs, comma-separated:

```text
https://web-intel-api-1.onrender.com,https://web-intel-api-2.onrender.com
```

Set `CLIENT_ORIGIN` on both API services to your frontend URL, for example:

```text
https://your-frontend.vercel.app
```

Set `MONGODB_URI` on both API services and both worker services to the same MongoDB Atlas URI.

## Notes

The Rust worker uses the Redis list named `webscrapper:jobs`. The TypeScript API already pushes new crawl jobs to that list when `REDIS_URL` is set, which is why this cluster uses Rust workers instead of the older Node worker container.
