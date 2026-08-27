import { logger } from '../../lib/logger';
import { parseWebhookPayload, type NormalizedMessageItem, type NormalizedStatusItem } from '../../integrations/meta/webhookPayload';
import { recordWebhookEventOnce, markWebhookEventProcessed, markWebhookEventFailed } from './webhookEvent.repository';
import { findPhoneNumberByMetaId } from '../whatsapp/whatsapp.repository';
import type { WhatsAppPhoneNumberDoc } from '../whatsapp/whatsappPhoneNumber.model';
import { findOrCreateContactByPhone } from '../contacts/contact.repository';
import { findOrCreateConversation, recordInboundActivity } from '../conversations/conversation.repository';
import { createMessage, updateMessageStatusByMetaId } from '../messages/message.repository';
import { createMedia } from '../media/media.repository';
import type { MessageStatus } from '../messages/message.model';
import { getRealtimeEmitter } from '../../realtime/events';
import { toRealtimeMessage, toRealtimeConversation } from '../../realtime/serializers';

const META_STATUS_MAP: Record<string, MessageStatus> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

function serializeError(err: unknown): unknown {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return err;
}

async function handleIncomingMessage(
  tenantId: string,
  phoneNumberDoc: WhatsAppPhoneNumberDoc,
  item: NormalizedMessageItem,
): Promise<void> {
  const contact = await findOrCreateContactByPhone(tenantId, item.from, item.contactName);
  const conversation = await findOrCreateConversation(tenantId, String(contact._id), String(phoneNumberDoc._id));

  let mediaId: string | undefined;
  if (item.mediaRef) {
    // Byte retrieval is deferred to an on-demand media proxy endpoint
    // (Phase 5+) rather than eagerly downloaded during webhook ingestion —
    // keeps this handler fast and doesn't require object storage yet.
    const media = await createMedia({
      tenantId,
      metaMediaId: item.mediaRef.metaMediaId,
      mimeType: item.mediaRef.mimeType ?? 'application/octet-stream',
      sizeBytes: 0,
      sha256: '',
      storageRef: `meta:${item.mediaRef.metaMediaId}`,
      status: 'READY',
    });
    mediaId = String(media._id);
  }

  const message = await createMessage({
    tenantId,
    conversationId: String(conversation._id),
    recipientPhone: phoneNumberDoc.displayPhoneNumber,
    direction: 'IN',
    type: item.messageType,
    text: item.text,
    mediaId,
    metaMessageId: item.messageId,
    status: 'DELIVERED',
  });

  const updatedConversation = await recordInboundActivity(
    String(conversation._id),
    tenantId,
    item.text ?? `[${item.messageType}]`,
    item.timestamp,
  );

  const realtime = getRealtimeEmitter();
  realtime.emitMessageNew(tenantId, toRealtimeMessage(message));
  if (updatedConversation) {
    realtime.emitConversationUpdated(tenantId, toRealtimeConversation(updatedConversation));
  }
}

async function handleStatusUpdate(tenantId: string, item: NormalizedStatusItem): Promise<void> {
  const ourStatus = META_STATUS_MAP[item.status];
  if (!ourStatus) {
    logger.debug({ status: item.status }, 'Ignoring unrecognized Meta message status');
    return;
  }

  const message = await updateMessageStatusByMetaId(item.messageId, tenantId, ourStatus, item.errors);
  if (!message) {
    // Status arrived before (or without) a matching local message row —
    // not an error; Meta's delivery order isn't guaranteed.
    logger.debug({ messageId: item.messageId, status: item.status }, 'Status update for unknown message');
    return;
  }

  const realtime = getRealtimeEmitter();
  realtime.emitMessageStatus(tenantId, String(message.conversationId), String(message._id), ourStatus);
}

/**
 * Processes exactly one normalized webhook item, end to end: idempotency
 * check → tenant resolution → dispatch → mark the WebhookEvent record
 * processed/failed. Safe to call repeatedly for the same item (spec §16) —
 * a duplicate is a guaranteed no-op via the unique index on metaEventId.
 */
async function processWebhookItem(item: NormalizedMessageItem | NormalizedStatusItem): Promise<void> {
  const { isNew, event } = await recordWebhookEventOnce(item.eventId, item.phoneNumberId, item.raw);
  if (!isNew) {
    logger.debug({ eventId: item.eventId }, 'Duplicate webhook delivery — skipping');
    return;
  }

  const phoneNumberDoc = await findPhoneNumberByMetaId(item.phoneNumberId);
  if (!phoneNumberDoc) {
    logger.warn({ phoneNumberId: item.phoneNumberId }, 'Webhook for unrecognized phone_number_id — ignoring');
    if (event) await markWebhookEventFailed(String(event._id), { reason: 'unknown_phone_number_id' });
    return;
  }
  // This is the tenant boundary for everything below — resolved from our
  // own WhatsAppPhoneNumber record, never from anything else in the payload.
  const tenantId = String(phoneNumberDoc.tenantId);

  try {
    if (item.kind === 'message') {
      await handleIncomingMessage(tenantId, phoneNumberDoc, item);
    } else {
      await handleStatusUpdate(tenantId, item);
    }
    if (event) await markWebhookEventProcessed(String(event._id), tenantId);
  } catch (err) {
    if (event) await markWebhookEventFailed(String(event._id), serializeError(err));
    throw err; // rethrow so the BullMQ job (or the inline-fallback caller) retries
  }
}

/** Entry point for one raw HTTP webhook delivery — may expand to multiple items. */
export async function processWebhookDelivery(rawPayload: unknown): Promise<void> {
  const items = parseWebhookPayload(rawPayload);
  for (const item of items) {
    await processWebhookItem(item);
  }
}
