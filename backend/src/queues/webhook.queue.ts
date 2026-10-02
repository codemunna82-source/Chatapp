import { Queue, Worker, type Job } from 'bullmq';
import { createBlockingRedisConnection, getRedisConnection } from './connection';
import { logger } from '../lib/logger';
import { processWebhookDelivery } from '../modules/webhooks/webhook.service';
import { captureBackgroundError } from '../lib/sentry';

export const WEBHOOK_QUEUE_NAME = 'meta-webhook-processing';

/**
 * How long to wait for Redis to accept a webhook before giving up on the
 * queue and processing it in this request instead.
 *
 * Short on purpose. A healthy Redis answers in single-digit milliseconds,
 * and what is left of Meta's delivery timeout after this has to be enough
 * to actually process the message — so this is a liveness check, not a
 * retry budget.
 */
const ENQUEUE_TIMEOUT_MS = 2000;

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
  const add = getWebhookQueue().add(
    'process',
    { rawPayload, receivedAt: new Date().toISOString() },
    {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  );

  /**
   * Bounded, because an unreachable Redis does not fail this call — it
   * hangs it, forever.
   *
   * The shared connection is built with maxRetriesPerRequest: null, which
   * BullMQ requires of a blocking connection: ioredis then retries a
   * command for as long as it takes and never rejects. So `await`ing this
   * against a Redis that is down does not throw, and the caller's
   * try/catch — the one whose whole purpose is to fall back to inline
   * processing — never runs.
   *
   * The cost of that was total: the webhook handler never returned, Meta
   * never got its 200, and every inbound message was redelivered and hung
   * again. A suspended Redis instance took inbound messaging down
   * completely while the service looked healthy and the logs showed
   * deliveries arriving.
   *
   * Rejecting on a timeout turns that back into the error the caller
   * already knows how to handle. The underlying add() is left pending
   * rather than cancelled — BullMQ offers no cancel, and if Redis returns
   * later the job simply runs, which is harmless: processing is idempotent
   * per item on metaEventId, so a job that duplicates work already done
   * inline is a no-op.
   */
  await Promise.race([
    add,
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Redis did not accept the webhook within ${ENQUEUE_TIMEOUT_MS}ms`)),
        ENQUEUE_TIMEOUT_MS,
      );
      // Never hold the process open for this: it is a guard on a request
      // that has its own lifetime, not work of its own.
      timer.unref?.();
      // Stop the timer as soon as the real call settles, so a healthy
      // enqueue does not leave a pending rejection behind it.
      void add.then(
        () => clearTimeout(timer),
        () => clearTimeout(timer),
      );
    }),
  ]);
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
    // Its own connection, never the shared one: a Worker blocks on Redis
    // and a blocked connection cannot serve the Queue's commands. Sharing
    // them left deliveries enqueued and never consumed — a 200 to Meta
    // and a message that never reached the inbox. See connection.ts.
    { connection: createBlockingRedisConnection(), concurrency: 5 },
  );

  // Worth a line each: a worker that never becomes ready is invisible
  // otherwise, and its absence is indistinguishable from an empty queue.
  worker.on('ready', () => logger.info({ queue: WEBHOOK_QUEUE_NAME }, 'Webhook worker ready'));
  worker.on('error', (err) => logger.error({ err, queue: WEBHOOK_QUEUE_NAME }, 'Webhook worker error'));
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
