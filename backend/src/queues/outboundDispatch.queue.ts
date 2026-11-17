import { Queue, Worker, type Job } from 'bullmq';
import { createBlockingRedisConnection, getRedisConnection, isRedisConfigured } from './connection';
import { logger } from '../lib/logger';
import { trace } from '../lib/perfTrace';
import { captureBackgroundError } from '../lib/sentry';
import { trySlotForDispatch } from '../modules/whatsapp/sendPacing';
import { dispatchAndFinalize } from '../modules/messages/metaDispatch';
import { findMessageByIdAndTenant, markMessageFailed } from '../modules/messages/message.repository';
import { findConversationByIdAndTenant } from '../modules/conversations/conversation.repository';
import { findContactByIdAndTenant } from '../modules/contacts/contact.repository';
import type { SendOutboundMessageInput } from '../modules/messages/message.service';

export const OUTBOUND_DISPATCH_QUEUE_NAME = 'outbound-dispatch';

/**
 * The paced half of sending a WhatsApp message — the other half of
 * sendPacing.ts, which decides WHETHER a send may go out right now; this
 * is where it actually goes out once it may, on whatever number it is
 * for, without one number's backlog holding up another's.
 *
 * One shared queue and worker across every tenant and every number
 * deliberately, rather than one per number: BullMQ's own rate limiter
 * (the `limiter` Worker option) throttles the whole queue as a unit, not
 * per job, so it cannot express "this number waits, that one doesn't" —
 * sendPacing.ts's Redis-keyed counter is what gives per-number fairness,
 * and it works the same whether one worker or many is reading this queue.
 * A worker per number was the other option and was rejected: each BullMQ
 * Worker holds its own blocking Redis connection (connection.ts explains
 * why it cannot share one), and a workspace with dozens of numbers would
 * open dozens of long-lived connections for this alone.
 */

/** Only meaningful when the pacing check says "not yet" — see the worker
 *  below. Short, because the point is to notice the moment a slot frees
 *  up, not to batch retries. */
const DEFER_RECHECK_DELAY_MS = 3_000;

/** How many times one message may be deferred before this gives up and
 *  marks it failed rather than queuing forever. At the recheck interval
 *  above, this is a 20-minute ceiling — generous for an ordinary busy
 *  spell, and long past the point where "still waiting" stops being an
 *  honest answer for an agent who tapped send. */
const MAX_DEFER_ATTEMPTS = 400;

/** The subset of SendOutboundMessageInput that dispatch() actually reads
 *  — see metaDispatch.ts. Carried in the job itself rather than read back
 *  off the Message row, because a template's language/components and a
 *  media send's caption/filename are request-time data that the stored
 *  row never keeps (message.model.ts has no columns for them). */
export interface OutboundDispatchInput {
  type: SendOutboundMessageInput['type'];
  text?: string;
  mediaId?: string;
  mediaLink?: string;
  caption?: string;
  filename?: string;
  templateName?: string;
  languageCode?: string;
  templateComponents?: unknown[];
  location?: SendOutboundMessageInput['location'];
  reactToMessageId?: string;
  emoji?: string;
  internal?: boolean;
}

export interface OutboundDispatchJobData {
  tenantId: string;
  messageId: string;
  conversationId: string;
  whatsappPhoneNumberId: string;
  isDemoContact: boolean;
  replyToMetaMessageId?: string;
  dispatchInput: OutboundDispatchInput;
  /** How many times this exact message has already been deferred. Absent
   *  on the first enqueue, which reads as 0. */
  attempt?: number;
}

let queue: Queue<OutboundDispatchJobData> | null = null;

function getOutboundDispatchQueue(): Queue<OutboundDispatchJobData> {
  if (!queue) {
    queue = new Queue<OutboundDispatchJobData>(OUTBOUND_DISPATCH_QUEUE_NAME, { connection: getRedisConnection() });
  }
  return queue;
}

/**
 * Hands a QUEUED message to the paced dispatch queue instead of sending
 * it inline. Called from message.service.ts only when sendPacing.ts has
 * already said there is no room right now — never on its own initiative.
 *
 * `delayMs` is only ever non-zero on a self-reschedule from the worker
 * below, when a recheck still found no room.
 */
export async function enqueueOutboundDispatch(data: OutboundDispatchJobData, delayMs = 0): Promise<void> {
  if (!isRedisConfigured()) {
    // Unreachable in practice — trySlotForDispatch fails open with no
    // Redis, so sendOutboundMessage never takes this branch without it —
    // but a safety net costs nothing and a silently dropped send is the
    // one outcome worse than any pacing decision.
    logger.error({ messageId: data.messageId }, 'enqueueOutboundDispatch called with no Redis configured — this should not happen');
    return;
  }

  await getOutboundDispatchQueue().add('dispatch', data, {
    delay: delayMs,
    // Unique per attempt: the worker's own reschedule bumps `attempt`,
    // so this never collides with the job it is rescheduling, but two
    // identical enqueue calls for the same attempt (a retried request,
    // say) land on the same job instead of sending twice.
    jobId: `${data.messageId}:${data.attempt ?? 0}`,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 2000 },
  });
}

async function processDispatchJob(job: Job<OutboundDispatchJobData>): Promise<void> {
  const { tenantId, messageId, conversationId, whatsappPhoneNumberId, isDemoContact, replyToMetaMessageId, dispatchInput } =
    job.data;

  const message = await findMessageByIdAndTenant(messageId, tenantId);
  if (!message) return; // Deleted or otherwise gone since this was queued — nothing left to send.
  if (message.status !== 'QUEUED') return; // Already resolved by some other path — never double-send.

  const conversation = await findConversationByIdAndTenant(conversationId, tenantId);
  if (!conversation) {
    await markMessageFailed(messageId, tenantId, {
      code: 'CONVERSATION_GONE',
      message: 'The conversation was deleted before this queued message could be sent.',
    });
    return;
  }

  const hasSlot = isDemoContact ? true : await trySlotForDispatch(whatsappPhoneNumberId, tenantId);
  if (!hasSlot) {
    const attempt = (job.data.attempt ?? 0) + 1;
    if (attempt > MAX_DEFER_ATTEMPTS) {
      await markMessageFailed(messageId, tenantId, {
        code: 'DISPATCH_PACING_TIMEOUT',
        message: 'Still rate-limited after repeated retries — gave up waiting for a send slot.',
      });
      logger.warn({ messageId, whatsappPhoneNumberId, attempt }, 'Gave up pacing a deferred send — number stayed over budget too long');
      return;
    }
    await enqueueOutboundDispatch({ ...job.data, attempt }, DEFER_RECHECK_DELAY_MS);
    return;
  }

  const contact = await findContactByIdAndTenant(String(conversation.contactId), tenantId);
  if (!contact) {
    await markMessageFailed(messageId, tenantId, {
      code: 'CONTACT_GONE',
      message: 'The contact was deleted before this queued message could be sent.',
    });
    return;
  }

  const input: SendOutboundMessageInput = { tenantId, conversationId, ...dispatchInput };
  const perf = trace('message.dispatch.paced', { conversationId, messageId });

  try {
    await dispatchAndFinalize(message, input, conversation, contact, isDemoContact, replyToMetaMessageId, perf);
  } catch (err) {
    // dispatchAndFinalize already marked the row FAILED (and, for an
    // auth error, flagged the connection expired) before throwing — there
    // is no HTTP response left to answer here, so this is the end of the
    // line for this attempt. Worth a line: a paced send failing is still
    // a send failing.
    logger.warn({ err, messageId }, 'A paced WhatsApp send was refused by Meta');
  }
}

let worker: Worker<OutboundDispatchJobData> | null = null;

/** Called once at process startup (server.ts) when Redis is configured. */
export function startOutboundDispatchWorker(): Worker<OutboundDispatchJobData> {
  if (worker) return worker;
  worker = new Worker<OutboundDispatchJobData>(
    OUTBOUND_DISPATCH_QUEUE_NAME,
    processDispatchJob,
    // Its own connection, for the same reason as every other worker in
    // this codebase: a Worker blocks on Redis, and a blocked connection
    // serves nothing else. Concurrency lets several numbers' deferred
    // sends proceed at once rather than queuing behind each other.
    { connection: createBlockingRedisConnection(), concurrency: 10 },
  );
  worker.on('error', (err) => logger.error({ err, queue: OUTBOUND_DISPATCH_QUEUE_NAME }, 'Outbound dispatch worker error'));
  worker.on('failed', (job, err) => {
    // Reached only if processDispatchJob itself threw, which it is
    // written not to — every expected outcome (sent, deferred again,
    // given up, refused by Meta) returns normally. A thrown error here
    // is a bug in the processor, not a declined send.
    logger.error({ jobId: job?.id, err }, 'Outbound dispatch job threw — this is a bug, not a declined send');
    captureBackgroundError(err, { source: 'outboundDispatch.worker', jobId: job?.id });
  });
  return worker;
}

export async function stopOutboundDispatchWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
