import { Queue, Worker, type Job } from 'bullmq';
import { createBlockingRedisConnection, getRedisConnection, isRedisConfigured } from './connection';
import { logger } from '../lib/logger';
import { captureBackgroundError } from '../lib/sentry';
import { findMessageByIdAndTenant } from '../modules/messages/message.repository';
import { sendOutboundMessage } from '../modules/messages/message.service';

export const MESSAGE_RETRY_QUEUE_NAME = 'message-rate-limit-retry';

/**
 * Automatic recovery for a Meta rate-limit refusal (130429) on an ordinary
 * text reply — the kind an agent would otherwise have to notice and tap
 * "retry" on by hand.
 *
 * Scoped to `type: 'text'` only. A template needs its language code and
 * component values to resend, and media needs its upload reference — none
 * of that survives on the stored Message row, only on the request that
 * created it, so retrying those from here would mean guessing at content
 * instead of resending it. Text is the one type the row itself carries in
 * full (`message.text`), and it is also what the actual incident this
 * exists for looked like: an agent's own plain replies, not templates,
 * failing in bulk alongside everything else on an overloaded number.
 *
 * Delayed rather than immediate: 130429 is a THROUGHPUT problem, and a
 * retry fired the instant the failure is known lands in the same crowded
 * second that caused it. Waiting gives the number's own pacing (and this
 * app's — see outboundPacing.ts) a real chance to have cleared by the
 * time the retry goes out.
 */
const RETRY_DELAY_MS = 45_000;

/** How many times one message may be auto-resent before this gives up and leaves it failed for an agent to retry by hand. */
const MAX_RATE_LIMIT_RETRIES = 2;

interface MessageRetryJobData {
  tenantId: string;
  messageId: string;
  attempt: number;
}

let queue: Queue<MessageRetryJobData> | null = null;

function getMessageRetryQueue(): Queue<MessageRetryJobData> {
  if (!queue) {
    queue = new Queue<MessageRetryJobData>(MESSAGE_RETRY_QUEUE_NAME, { connection: getRedisConnection() });
  }
  return queue;
}

/**
 * Schedules one retry of a rate-limited text message, if it has not
 * already used up its allowance.
 *
 * Called from webhook.service.ts's handleStatusUpdate, the only place a
 * 130429 refusal is ever learned about. No-ops (returns false) with no
 * Redis configured — same fail-open rule as outboundPacing.ts: a recovery
 * feature that cannot run must not become a reason anything else breaks.
 */
export async function scheduleRateLimitRetry(input: { tenantId: string; messageId: string }): Promise<boolean> {
  if (!isRedisConfigured()) return false;

  const message = await findMessageByIdAndTenant(input.messageId, input.tenantId);
  if (!message) return false;

  const attempt = (message.rateLimitRetryAttempt ?? 0) + 1;
  if (attempt > MAX_RATE_LIMIT_RETRIES) return false;

  try {
    await getMessageRetryQueue().add(
      'retry',
      { tenantId: input.tenantId, messageId: input.messageId, attempt },
      {
        delay: RETRY_DELAY_MS,
        // Stable per message+attempt: a redelivered status webhook for the
        // same refusal (Meta's delivery isn't exactly-once either) must not
        // queue the same retry twice.
        jobId: `${input.messageId}:${attempt}`,
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 2000 },
      },
    );
    return true;
  } catch (err) {
    logger.warn({ err, messageId: input.messageId, attempt }, 'Could not schedule a rate-limit retry — leaving the message failed');
    return false;
  }
}

async function processRetry(job: Job<MessageRetryJobData>): Promise<void> {
  const { tenantId, messageId, attempt } = job.data;
  const message = await findMessageByIdAndTenant(messageId, tenantId);
  // Deleted, revoked, or otherwise gone since this was scheduled — nothing
  // left to resend on behalf of.
  if (!message || message.type !== 'text' || message.deletedAt || message.revokedAt) return;

  await sendOutboundMessage({
    tenantId,
    conversationId: String(message.conversationId),
    senderId: message.senderId ? String(message.senderId) : undefined,
    type: 'text',
    text: message.text ?? undefined,
    internal: message.internal,
    rateLimitRetryAttempt: attempt,
    replyToMessageId: message.replyToMessageId ? String(message.replyToMessageId) : undefined,
    // Deliberately no clientMessageId: the failed send already used its
    // id (clientMessageId is unique per tenant), and this is a new row —
    // exactly as an agent's own manual "tap to retry" also produces one.
  });
}

let worker: Worker<MessageRetryJobData> | null = null;

/** Called once at process startup (server.ts) when Redis is configured. */
export function startMessageRetryWorker(): Worker<MessageRetryJobData> {
  if (worker) return worker;
  worker = new Worker<MessageRetryJobData>(
    MESSAGE_RETRY_QUEUE_NAME,
    processRetry,
    // Its own connection, for the same reason as every other worker here:
    // a Worker blocks on Redis and a blocked connection serves nothing else.
    { connection: createBlockingRedisConnection(), concurrency: 5 },
  );
  worker.on('error', (err) => logger.error({ err, queue: MESSAGE_RETRY_QUEUE_NAME }, 'Message retry worker error'));
  worker.on('failed', (job, err) => {
    // sendOutboundMessage threw for a reason that isn't "Meta rate-limited
    // it again" (that outcome is a success for THIS job — the resend went
    // out and will get its own status webhook, which schedules the next
    // retry itself if one is still owed). An auth failure, a deleted
    // conversation, anything else: worth a line, not worth retrying blind.
    logger.error({ jobId: job?.id, err }, 'Rate-limit retry send failed');
    captureBackgroundError(err, { source: 'messageRetry.worker', jobId: job?.id });
  });
  return worker;
}

export async function stopMessageRetryWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
