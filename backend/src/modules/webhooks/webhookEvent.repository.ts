import { WebhookEvent, type WebhookEventDoc } from './webhookEvent.model';

interface MongoDuplicateKeyError {
  code?: number;
}

/**
 * Idempotent record of an inbound webhook delivery. Relies on the unique
 * index on `metaEventId` (spec §16) — if this event id was already seen,
 * the create throws a duplicate-key error (code 11000), which we translate
 * into `{ isNew: false }` so the caller skips reprocessing rather than
 * treating it as a failure.
 */
export async function recordWebhookEventOnce(
  metaEventId: string,
  phoneNumberId: string,
  payload: unknown,
): Promise<{ isNew: boolean; event: WebhookEventDoc | null }> {
  try {
    const event = await WebhookEvent.create({ metaEventId, phoneNumberId, payload, status: 'RECEIVED' });
    return { isNew: true, event };
  } catch (err) {
    if ((err as MongoDuplicateKeyError).code === 11000) {
      return { isNew: false, event: null };
    }
    throw err;
  }
}

export async function markWebhookEventProcessed(id: string, tenantId?: string): Promise<void> {
  await WebhookEvent.updateOne(
    { _id: id },
    { $set: { status: 'PROCESSED', processedAt: new Date(), ...(tenantId ? { tenantId } : {}) } },
  );
}

export async function markWebhookEventFailed(id: string, error: unknown): Promise<void> {
  await WebhookEvent.updateOne({ _id: id }, { $set: { status: 'FAILED', error } });
}
