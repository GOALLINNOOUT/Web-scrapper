import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import cluster from 'node:cluster';
import http from 'node:http';
import os from 'node:os';
import dotenv from 'dotenv';
import { createApp } from './app.js';
import { connectDatabase } from './lib/db.js';
import { CrawlManager } from './crawler/CrawlManager.js';
import { createQueues } from './queue/queues.js';
import { startQueueWorkers } from './queue/workers.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { attachLiveWebSocketServer } from './services/liveEvents.js';
import { attachAdminSocketServer } from './services/socketServer.js';
import { startAdminMetricsCollector } from './services/metricsCollector.js';

dotenv.config();

const port = config.port;

async function main() {
  if (config.performanceMode === 'production' && !config.redisUrl) {
    throw new Error('REDIS_URL is required when PERFORMANCE_MODE=production');
  }

  await connectDatabase(config.mongodbUri);

  const queues = config.redisUrl ? createQueues() : undefined;
  const crawlManager = new CrawlManager(queues);
  const shouldStartLocalWorkers = queues && (
    config.performanceMode === 'production'
      ? process.env.START_WORKERS_IN_API === 'true'
      : process.env.START_WORKERS_IN_API !== 'false'
  );
  if (shouldStartLocalWorkers) {
    startQueueWorkers(queues);
  } else if (!queues) {
    logger.warn('REDIS_URL is not set. Falling back to in-process crawling for local development.');
  }
  const app = createApp({ crawlManager });
  const server = http.createServer(app);
  attachLiveWebSocketServer(server);
  attachAdminSocketServer(server);
  startAdminMetricsCollector(queues);

  server.listen(port, () => {
    logger.info({ port }, 'Crawler API listening');
  });
}

if (cluster.isPrimary && config.nodeEnv === 'production' && config.webWorkers !== 1) {
  const workers = config.webWorkers || os.cpus().length;
  logger.info({ workers }, 'Primary starting API workers');
  for (let index = 0; index < workers; index += 1) cluster.fork();

  cluster.on('exit', (worker, code, signal) => {
    logger.error({ workerPid: worker.process.pid, code, signal }, 'API worker died; restarting');
    cluster.fork();
  });

  process.on('SIGTERM', () => {
    logger.info('Primary received SIGTERM; shutting down workers');
    for (const id in cluster.workers) cluster.workers[id]?.send('shutdown');
  });
} else {
  main().catch((error) => {
    logger.error(error, 'Failed to start server');
    process.exit(1);
  });
}
