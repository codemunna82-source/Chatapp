import { Queue, Worker, type Job } from 'bullmq';
import { Types } from 'mongoose';
import { getRedisConnection } from './connection';
import { logger } from '../lib/logger';
import { Subscription, type SubscriptionStatusLabel } from '../modules/subscriptions/subscription.model';
import { computeCurrentStatus } from '../modules/subscriptions/subscription.repository';
import { User } from '../modules/users/user.model';
import { createNotification } from '../modules/notifications/notification.repository';
import { recordAudit } from '../modules/audit/auditLog.service';
import { captureBackgroundError } from '../lib/sentry';

export const SUBSCRIPTION_EXPIRY_QUEUE_NAME = 'subscription-expiry-sweep';
const SWEEP_JOB_NAME = 'sweep';
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly, per ARCHITECTURE.md §7

let queue: Queue | null = null;

function getSubscriptionExpiryQueue(): Queue {
  if (!queue) {
    queue = new Queue(SUBSCRIPTION_EXPIRY_QUEUE_NAME, { connection: getRedisConnection() });
  }
  return queue;
}

/**
 * Convenience-cache sweep only (spec §7 / ARCHITECTURE.md §7): recomputes
 * each tenant's *current* subscription status live and, on a transition,
 * updates the cached `Subscription.status` field and stamps a Notification
 * + AuditLog entry. The auth middleware never reads this cached field for
 * access decisions — it always does its own live validFrom/validUntil
 * comparison — so a delayed or skipped sweep can never grant unauthorized
 * access, only delay a notification.
 */
export async function sweepSubscriptionExpiry(): Promise<{ transitioned: number }> {
  // "Current" subscription per tenant = the most recently created row.
  const current = await Subscription.aggregate<{ _id: Types.ObjectId; doc: Record<string, unknown> }>([
    { $sort: { tenantId: 1, createdAt: -1 } },
    { $group: { _id: '$tenantId', doc: { $first: '$$ROOT' } } },
  ]);

  let transitioned = 0;

  for (const row of current) {
    const doc = row.doc as {
      _id: Types.ObjectId;
      tenantId: Types.ObjectId;
      status: SubscriptionStatusLabel;
      validFrom: Date;
      validUntil: Date;
      plan: string;
    };
    const liveStatus = computeCurrentStatus(doc);
    if (liveStatus === doc.status || liveStatus === 'SUSPENDED') continue; // SUSPENDED is admin-set, never sweep-derived

    await Subscription.updateOne({ _id: doc._id }, { $set: { status: liveStatus } });
    transitioned += 1;

    if (liveStatus === 'EXPIRING' || liveStatus === 'EXPIRED') {
      const tenantId = String(doc.tenantId);
      const notifType = liveStatus === 'EXPIRING' ? 'SUBSCRIPTION_EXPIRING' : 'SUBSCRIPTION_EXPIRED';
      const title = liveStatus === 'EXPIRING' ? 'Your subscription is expiring soon' : 'Your subscription has expired';
      const body =
        liveStatus === 'EXPIRING'
          ? `The ${doc.plan} plan expires on ${doc.validUntil.toISOString().slice(0, 10)}. Renew to avoid interruption.`
          : `The ${doc.plan} plan expired on ${doc.validUntil.toISOString().slice(0, 10)}.`;

      const activeUsers = await User.find({ tenantId: doc.tenantId, status: 'ACTIVE' }, { _id: 1 });
      await Promise.all(
        activeUsers.map((u) =>
          createNotification({
            tenantId,
            userId: String(u._id),
            type: notifType,
            title,
            body,
          }),
        ),
      );

      await recordAudit({
        tenantId,
        action: 'subscription.status_transition',
        targetType: 'Subscription',
        targetId: doc._id,
        metadata: { from: doc.status, to: liveStatus },
      });
    }
  }

  return { transitioned };
}

let worker: Worker | null = null;

/** Called once at process startup (server.ts) when Redis is configured. */
export function startSubscriptionExpiryWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(
    SUBSCRIPTION_EXPIRY_QUEUE_NAME,
    async (_job: Job) => {
      const result = await sweepSubscriptionExpiry();
      if (result.transitioned > 0) {
        logger.info(result, 'Subscription expiry sweep transitioned tenants');
      }
    },
    { connection: getRedisConnection(), concurrency: 1 },
  );
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Subscription expiry sweep job failed');
    captureBackgroundError(err, { source: 'subscriptionExpiry.worker', jobId: job?.id });
  });
  return worker;
}

/** Schedules the hourly repeatable sweep job — safe to call on every boot, BullMQ dedupes by job id. */
export async function scheduleSubscriptionExpirySweep(): Promise<void> {
  await getSubscriptionExpiryQueue().add(
    SWEEP_JOB_NAME,
    {},
    {
      repeat: { every: SWEEP_INTERVAL_MS },
      jobId: 'subscription-expiry-hourly',
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  );
}

export async function stopSubscriptionExpiryWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
