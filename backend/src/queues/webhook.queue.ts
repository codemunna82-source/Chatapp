import { Queue, Worker, type Job } from 'bullmq';
import { getRedisConnection } from './connection';
import { logger } from '../lib/logger';
import { processWebhookDelivery } from '../modules/webhooks/webhook.service';
import { captureBackgroundError } from '../lib/sentry';

export const WEBHOOK_QUEUE_NAME = 'meta-webhook-processing';

export interface WebhookJobData {
  rawPayload: unknown;
  receivedAt: string;
}

let queue: Queue<WebhookJobData> | null = null;

function getWebhookQueue(): Queue<WebhookJobData> {
  if (!queue) {
    queue = new Queue<WebhookJobData>(WEBHOOK_QUEUE_NAME, { connection: getRedisConnection() });
  }
  return queue;
}

/**
 * Enqueues one webhook HTTP delivery for async processing (spec §38).
 * Jobs are retried with backoff on failure — `processWebhookDelivery`
 * itself is idempotent per-item (see webhook.service.ts), so a retried job
 * re-processing an already-handled item is always a safe no-op.
 */
export async function enqueueWebhookDelivery(rawPayload: unknown): Promise<void> {
  await getWebhookQueue().add(
    'process',
    { rawPayload, receivedAt: new Date().toISOString() },
    {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  );
}

let worker: Worker<WebhookJobData> | null = null;

/** Called once at process startup (server.ts) when Redis is configured. */
export function startWebhookWorker(): Worker<WebhookJobData> {
  if (worker) return worker;
  worker = new Worker<WebhookJobData>(
    WEBHOOK_QUEUE_NAME,
    async (job: Job<WebhookJobData>) => {
      await processWebhookDelivery(job.data.rawPayload);
    },
    { connection: getRedisConnection(), concurrency: 5 },
  );
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Webhook processing job failed');
    // A queue worker has no error middleware to fall through to, so
    // without this a failed webhook — a message that never reached the
    // inbox — is only ever a line in a log nobody is watching.
    captureBackgroundError(err, { source: 'webhook.worker', jobId: job?.id });
  });
  return worker;
}

export async function stopWebhookWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
