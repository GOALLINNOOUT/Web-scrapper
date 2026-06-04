import type { QueueBundle } from '../queue/queues.js';
import { domainRefreshJobId } from '../queue/jobIds.js';

export async function queueDomainProfileRefresh(
  queues: QueueBundle,
  input: { deviceId: string; domain: string; delayMs?: number; force?: boolean }
) {
  const domain = input.domain.trim().toLowerCase().replace(/^www\./, '');
  if (!input.deviceId || !domain) return;

  await queues.domainEnrichment.add(
    'refresh-domain-profile',
    { deviceId: input.deviceId, domain, force: Boolean(input.force) },
    {
      delay: Math.max(0, input.delayMs || 0),
      jobId: domainRefreshJobId(input.deviceId, domain),
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200
    }
  );
}
