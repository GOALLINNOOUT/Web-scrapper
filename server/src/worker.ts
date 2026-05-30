import dotenv from 'dotenv';
import { connectDatabase } from './lib/db.js';
import { createQueues } from './queue/queues.js';
import { startQueueWorkers } from './queue/workers.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';

dotenv.config();

async function main() {
  await connectDatabase(config.mongodbUri);
  const queues = createQueues();
  const workers = startQueueWorkers(queues);

  logger.info('Crawler workers are listening for queued jobs');

  async function shutdown() {
    await workers.close();
    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  logger.error(error, 'Failed to start workers');
  process.exit(1);
});
