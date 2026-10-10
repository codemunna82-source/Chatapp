import { Queue, Worker, type Job } from 'bullmq';
import { createBlockingRedisConnection, getRedisConnection, isRedisConfigured } from './connection';
import { logger } from '../lib/logger';
import { captureBackgroundError } from '../lib/sentry';
import { attemptAutomaticGuestLinkInvitation } from '../modules/guest/guestAutoReply.service';

export const AUTOMATIC_INVITE_DISPATCH_QUEUE_NAME = 'automatic-invite-dispatch';

/**
 * What outboundPacing.ts's 15-per-minute cap on the automatic private-chat
 * invitation does with the customers it turns away: holds them here and
 * retries once the number's window has room again, instead of dropping
 * them on the spot. Before this queue existed, a burst past the cap — a
 * hundred people writing in inside the same minute, say — got the first
 * fifteen invited and left the other eighty-five with nothing, silently,
 * unless they happened to write in again later and trigger a fresh
 * attempt. Now they wait their turn instead of losing it.
 *
 * Deliberately separate from outboundDispatch.queue.ts (the general send
 * pacing queue): that one defers a message that has already been created
 * and committed to sending. This sits a layer earlier, before
 * deliverGuestLinkInvitation has created anything (no session, no
 * message row) — retrying here means re-running the whole attempt,
 * gates included, not resuming a specific send.
 */
const RECHECK_DELAY_MS = 5_000;

/** ~5 minutes of rechecking at the delay above — several of
 *  outboundPacing's own 60-second windows, generous for even a sustained
 *  burst, short enough that a customer is not left silently "pending"
 *  forever if the number stays saturated with real traffic. */
const MAX_DEFER_ATTEMPTS = 60;

/**
 * The window every FIRST automatic send is spread across, instead of
 * leaving the instant its inbound message arrives.
 *
 * A burst of customers writing in within the same minute used to mean a
 * burst of invitations leaving within the same few seconds — many sends
 * on one number, clustered tightly enough in time that it reads as
 * machine traffic rather than as the many independent, one-at-a-time
 * replies it actually is. That clustering, not just the raw count, is
 * part of what trips Meta's 130429 rate limiting.
 *
 * Spacing them at a FIXED interval (send #1 at +2s, #2 at +4s, ...) would
 * just trade one detectable pattern for another. Giving each one an
 * independent random delay in this window is what makes the traffic look
 * like what it is — unrelated customers, each answered once, at whatever
 * moment that lands.
 */
const JITTER_MIN_MS = 1_000;
const JITTER_MAX_MS = 45_000;

/**
 * A random delay for a first dispatch attempt, uniform over
 * [JITTER_MIN_MS, JITTER_MAX_MS). Called once per inbound message, so two
 * numbers — or two customers on the same number — each land on their own
 * independent draw rather than any shared schedule; at this window's
 * resolution, two sends landing on the exact same instant is not a
 * pattern worth engineering around.
 */
export function randomDispatchDelayMs(): number {
  return JITTER_MIN_MS + Math.floor(Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS));
}

export interface AutomaticInviteDispatchJobData {
  tenantId: string;
  conversationId: string;
  contactId: string;
  whatsappPhoneNumberId: string;
  /** How many times this exact invitation attempt has already been
   *  deferred. Absent on the first enqueue, which reads as 0. */
  attempt?: number;
}

let queue: Queue<AutomaticInviteDispatchJobData> | null = null;

function getAutomaticInviteDispatchQueue(): Queue<AutomaticInviteDispatchJobData> {
  if (!queue) {
    queue = new Queue<AutomaticInviteDispatchJobData>(AUTOMATIC_INVITE_DISPATCH_QUEUE_NAME, {
      connection: getRedisConnection(),
    });
  }
  return queue;
}

/**
 * Schedules an attempt at the automatic invitation — the FIRST one, at a
 * random delay from randomDispatchDelayMs(), or a retry at RECHECK_DELAY_MS
 * once outboundPacing.ts has said this number is over its automatic-send
 * budget for the current minute. Either way the attempt itself (including
 * the pacing check) only runs when the delayed job fires, in
 * processDispatchJob below.
 */
export async function enqueueAutomaticInviteDispatch(
  data: AutomaticInviteDispatchJobData,
  delayMs: number = RECHECK_DELAY_MS,
): Promise<void> {
  if (!isRedisConfigured()) {
    // No longer unreachable: every first automatic send now comes through
    // here (see maybeSendGuestLinkAutoReply), not only the rate-limited
    // overflow case. With no Redis configured there is nowhere to hold a
    // delayed job, so the invitation cannot go out jittered — only
    // un-jittered, which defeats the point. Logged loudly because this
    // now means no automatic invitations at all, not a rare edge case.
    logger.error(
      { conversationId: data.conversationId },
      'enqueueAutomaticInviteDispatch called with no Redis configured — automatic invitations cannot be sent at all without it',
    );
    return;
  }

  await getAutomaticInviteDispatchQueue().add('dispatch', data, {
    delay: delayMs,
    // Stable per conversation+attempt: a second inbound message from the
    // same customer while a retry is already pending must not queue a
    // second one racing it. BullMQ rejects a custom job id containing
    // ':' (it uses that character itself as a Redis-key delimiter), so
    // this uses '-' instead.
    jobId: `${data.conversationId}-${data.attempt ?? 0}`,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 2000 },
  });
}

async function processDispatchJob(job: Job<AutomaticInviteDispatchJobData>): Promise<void> {
  const { tenantId, conversationId, contactId, whatsappPhoneNumberId } = job.data;

  // The exact same gates as the first attempt, re-run fresh — so a
  // customer who has since opened the private chat some other way, or
  // whose invite count has since changed, is read correctly rather than
  // acted on stale state.
  const outcome = await attemptAutomaticGuestLinkInvitation({
    tenantId,
    conversationId,
    contactId,
    whatsappPhoneNumberId,
  });
  if (outcome !== 'rate-limited') return; // Sent, or skipped for a reason a retry cannot fix — nothing left to do.

  const attempt = (job.data.attempt ?? 0) + 1;
  if (attempt > MAX_DEFER_ATTEMPTS) {
    logger.warn(
      { tenantId, conversationId, whatsappPhoneNumberId, attempt },
      'Gave up retrying a deferred automatic invitation — this number stayed over its automatic-send budget too long',
    );
    return;
  }
  await enqueueAutomaticInviteDispatch({ ...job.data, attempt }, RECHECK_DELAY_MS);
}

let worker: Worker<AutomaticInviteDispatchJobData> | null = null;

/** Called once at process startup (server.ts) when Redis is configured. */
export function startAutomaticInviteDispatchWorker(): Worker<AutomaticInviteDispatchJobData> {
  if (worker) return worker;
  worker = new Worker<AutomaticInviteDispatchJobData>(
    AUTOMATIC_INVITE_DISPATCH_QUEUE_NAME,
    processDispatchJob,
    // Its own connection, for the same reason as every other worker in
    // this codebase: a Worker blocks on Redis, and a blocked connection
    // serves nothing else.
    { connection: createBlockingRedisConnection(), concurrency: 10 },
  );
  worker.on('error', (err) =>
    logger.error({ err, queue: AUTOMATIC_INVITE_DISPATCH_QUEUE_NAME }, 'Automatic invite dispatch worker error'),
  );
  worker.on('failed', (job, err) => {
    // Reached only if processDispatchJob itself threw, which it is
    // written not to — attemptAutomaticGuestLinkInvitation never throws
    // (deliverGuestLinkInvitation's own contract) and every other branch
    // here returns normally. A thrown error is a bug in the processor,
    // not a declined invitation.
    logger.error({ jobId: job?.id, err }, 'Automatic invite dispatch job threw — this is a bug, not a declined invitation');
    captureBackgroundError(err, { source: 'automaticInviteDispatch.worker', jobId: job?.id });
  });
  return worker;
}

export async function stopAutomaticInviteDispatchWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
