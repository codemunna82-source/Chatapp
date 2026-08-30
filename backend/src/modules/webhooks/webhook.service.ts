import { logger } from '../../lib/logger';
import type { NormalizedCallItem, NormalizedWebhookItem } from '../../integrations/meta/webhookPayload';
import { parseWebhookPayload, type NormalizedMessageItem, type NormalizedStatusItem } from '../../integrations/meta/webhookPayload';
import { recordWebhookEventOnce, markWebhookEventProcessed, markWebhookEventFailed } from './webhookEvent.repository';
import { findPhoneNumberByMetaId } from '../whatsapp/whatsapp.repository';
import type { WhatsAppPhoneNumberDoc } from '../whatsapp/whatsappPhoneNumber.model';
import { findOrCreateContactByPhone } from '../contacts/contact.repository';
import {
  findOrCreateConversation,
  recordInboundActivity,
  updateLastMessageStatus,
  findConversationByIdAndTenant,
} from '../conversations/conversation.repository';
import {
  createMessage,
  updateMessageStatusByMetaId,
  findMessageByMetaIdAndTenant,
  findMessageByIdAndTenant,
} from '../messages/message.repository';
import { pushIncomingMessage, pushReaction } from '../notifications/push.service';
import { handleInboundCallEvent } from '../calls/call.service';
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
      whatsappPhoneNumberId: String(phoneNumberDoc._id),
      metaMediaId: item.mediaRef.metaMediaId,
      mimeType: item.mediaRef.mimeType ?? 'application/octet-stream',
      sizeBytes: 0,
      sha256: '',
      storageRef: `meta:${item.mediaRef.metaMediaId}`,
      status: 'READY',
    });
    mediaId = String(media._id);
  }

  // A reaction links to the message it targets via replyToMessageId (the
  // same field a reply uses) so the client can attach it to the right
  // bubble instead of rendering it as its own top-level message.
  let replyToMessageId: string | undefined;
  if (item.messageType === 'reaction') {
    const raw = item.raw as { reaction?: { message_id?: string } };
    const targetMetaMessageId = raw.reaction?.message_id;
    if (targetMetaMessageId) {
      const target = await findMessageByMetaIdAndTenant(targetMetaMessageId, tenantId);
      replyToMessageId = target ? String(target._id) : undefined;
    }
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
    replyToMessageId,
    status: 'DELIVERED',
  });

  const updatedConversation = await recordInboundActivity(
    String(conversation._id),
    tenantId,
    item.text ?? `[${item.messageType}]`,
    item.timestamp,
  );

  const realtime = getRealtimeEmitter();
  realtime.emitMessageNew(tenantId, toRealtimeMessage(message), String(conversation.whatsappPhoneNumberId));
  if (updatedConversation) {
    realtime.emitConversationUpdated(tenantId, toRealtimeConversation(updatedConversation));
  }

  // Push last, and never awaited for its result beyond its own internal
  // error handling: the message is already stored and already delivered to
  // every open app over the socket. A push failure must not fail this
  // handler, because Meta would then retry the whole delivery and the
  // message would be processed twice.
  const contactName = contact.name || contact.phone;
  if (item.messageType === 'reaction') {
    const raw = item.raw as { reaction?: { emoji?: string } };
    const target = replyToMessageId ? await findMessageByIdAndTenant(replyToMessageId, tenantId) : null;
    await pushReaction({
      tenantId,
      conversationId: String(conversation._id),
      whatsappPhoneNumberId: String(conversation.whatsappPhoneNumberId),
      contactName,
      emoji: raw.reaction?.emoji,
      targetPreview: target?.text ?? undefined,
    });
  } else {
    await pushIncomingMessage({
      tenantId,
      conversationId: String(conversation._id),
      whatsappPhoneNumberId: String(conversation.whatsappPhoneNumberId),
      contactName,
      messageType: item.messageType,
      text: item.text,
    });
  }
}

async function handleStatusUpdate(tenantId: string, item: NormalizedStatusItem): Promise<void> {
  const ourStatus = META_STATUS_MAP[item.status];
  if (!ourStatus) {
    logger.debug({ status: item.status }, 'Ignoring unrecognized Meta message status');
    return;
  }

  // item.timestamp is Meta's own — see the model's note on why the webhook's
  // time is used rather than the moment this handler ran.
  const message = await updateMessageStatusByMetaId(
    item.messageId,
    tenantId,
    ourStatus,
    item.errors,
    item.timestamp,
  );
  if (!message) {
    // Status arrived before (or without) a matching local message row —
    // not an error; Meta's delivery order isn't guaranteed.
    logger.debug({ messageId: item.messageId, status: item.status }, 'Status update for unknown message');
    return;
  }

  // Keeps the chat list's tick in step. Scoped to lastMessageId inside the
  // repository, so a late status for an older message cannot rewrite a row
  // that has since moved on.
  await updateLastMessageStatus(tenantId, String(message._id), ourStatus);

  const realtime = getRealtimeEmitter();
  // Loaded before the emit rather than after: the status event now has to
  // be addressed to the conversation's number, so it needs the row anyway.
  const conversation = await findConversationByIdAndTenant(String(message.conversationId), tenantId);
  if (conversation) {
    realtime.emitMessageStatus(
      tenantId,
      String(message.conversationId),
      String(message._id),
      ourStatus,
      String(conversation.whatsappPhoneNumberId),
    );
    // The row's tick lives on the conversation, so the list needs its own
    // event — message:status alone only updates an open chat's bubbles.
    realtime.emitConversationUpdated(tenantId, toRealtimeConversation(conversation));
  }
}

/**
 * Processes exactly one normalized webhook item, end to end: idempotency
 * check → tenant resolution → dispatch → mark the WebhookEvent record
 * processed/failed. Safe to call repeatedly for the same item (spec §16) —
 * a duplicate is a guaranteed no-op via the unique index on metaEventId.
 */
async function processWebhookItem(item: NormalizedWebhookItem): Promise<void> {
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
    } else if (item.kind === 'call') {
      await handleCallEvent(tenantId, phoneNumberDoc, item);
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

/**
 * An inbound voice call, or its end.
 *
 * Kept as a thin hand-off: the call module owns what a call means, this
 * function owns only that the event reached the right tenant. Same split
 * as messages.
 */
async function handleCallEvent(
  tenantId: string,
  phoneNumberDoc: WhatsAppPhoneNumberDoc,
  item: NormalizedCallItem,
): Promise<void> {
  await handleInboundCallEvent(tenantId, phoneNumberDoc, item);
}
