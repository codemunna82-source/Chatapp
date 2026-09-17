import { maybeSendGuestLinkAutoReply } from '../guest/guestAutoReply.service';
import { logger } from '../../lib/logger';
import type { NormalizedCallItem, NormalizedWebhookItem } from '../../integrations/meta/webhookPayload';
import { parseWebhookPayload, type NormalizedMessageItem, type NormalizedStatusItem } from '../../integrations/meta/webhookPayload';
import { recordWebhookEventOnce, markWebhookEventProcessed, markWebhookEventFailed } from './webhookEvent.repository';
import { findPhoneNumberByMetaId } from '../whatsapp/whatsapp.repository';
import type { WhatsAppPhoneNumberDoc } from '../whatsapp/whatsappPhoneNumber.model';
import { findOrCreateContactByPhone } from '../contacts/contact.repository';
import { refundInviteSent } from '../guest/guestSession.repository';
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
  revealInternalMessage,
} from '../messages/message.repository';
import { pushIncomingMessage, pushReaction } from '../notifications/push.service';
import { handleInboundCallEvent } from '../calls/call.service';
import { createMedia } from '../media/media.repository';
import type { MessageStatus } from '../messages/message.model';
import { contactDisplayName } from '../../lib/phone';
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
      // Both unknown until the proxy actually fetches the bytes. Left
      // absent rather than zero-and-empty-string: '' is indistinguishable
      // from "not set" to Mongoose anyway, and pretending to know a hash we
      // have not computed is worse than admitting we do not have one.
      sizeBytes: 0,
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
    channel: 'whatsapp',
    type: item.messageType,
    text: item.text,
    location: item.location,
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

  // Held back while the customer has been invited to the web window and
  // has not moved over yet. The message is already stored — this only
  // decides whether anyone is told about it now, or when they arrive.
  // See conversation.model.ts's awaitingWebChat for why holding beats
  // dropping.
  const held = updatedConversation?.awaitingWebChat === true;

  const realtime = getRealtimeEmitter();
  if (!held) {
    realtime.emitMessageNew(tenantId, toRealtimeMessage(message), String(conversation.whatsappPhoneNumberId));
    if (updatedConversation) {
      realtime.emitConversationUpdated(tenantId, toRealtimeConversation(updatedConversation));
    }
  }

  // Push last, and never awaited for its result beyond its own internal
  // error handling: the message is already stored and already delivered to
  // every open app over the socket. A push failure must not fail this
  // handler, because Meta would then retry the whole delivery and the
  // message would be processed twice.
  const contactName = contactDisplayName(contact);
  // No push either, for the same reason: a notification about a message
  // the inbox is deliberately not showing would send an agent looking for
  // a conversation that is not there.
  if (held) {
    await maybeSendGuestLinkAutoReply({
      tenantId,
      conversationId: String(conversation._id),
      contactId: String(contact._id),
      whatsappPhoneNumberId: String(conversation.whatsappPhoneNumberId),
      inboundMessageType: item.messageType,
    });
    return;
  }

  if (item.messageType === 'reaction') {
    const raw = item.raw as { reaction?: { emoji?: string } };
    const target = replyToMessageId ? await findMessageByIdAndTenant(replyToMessageId, tenantId) : null;
    await pushReaction({
      tenantId,
      conversationId: String(conversation._id),
      whatsappPhoneNumberId: String(conversation.whatsappPhoneNumberId),
      contactName,
      contactId: String(contact._id),
      // The photo's own version, so a notification shows the
      // picture the contact has now rather than one the phone
      // cached weeks ago.
      avatarVersion: contact.avatarUpdatedAt?.toISOString(),
      emoji: raw.reaction?.emoji,
      targetPreview: target?.text ?? undefined,
    });
  } else {
    await pushIncomingMessage({
      tenantId,
      conversationId: String(conversation._id),
      whatsappPhoneNumberId: String(conversation.whatsappPhoneNumberId),
      contactName,
      contactId: String(contact._id),
      // The photo's own version, so a notification shows the
      // picture the contact has now rather than one the phone
      // cached weeks ago.
      avatarVersion: contact.avatarUpdatedAt?.toISOString(),
      messageType: item.messageType,
      text: item.text,
      sentAt: message.createdAt,
    });
  }

  // Last, and after the push, deliberately: the agent should hear about
  // the customer's message before the system answers on their behalf.
  // Swallows its own errors for the same reason the push above does — a
  // failure here must not fail the delivery and have Meta retry it.
  await maybeSendGuestLinkAutoReply({
    tenantId,
    conversationId: String(conversation._id),
    contactId: String(contact._id),
    whatsappPhoneNumberId: String(conversation.whatsappPhoneNumberId),
    inboundMessageType: item.messageType,
  });
}

/**
 * Meta's reason codes out of a `failed` status, for the log.
 *
 * Code and title only. They are Meta's own fixed identifiers — the kind of
 * thing you paste into their error reference — while `details` is free text
 * that carries account and asset ids. The whole payload is kept on the
 * message row either way, so nothing is lost by keeping the log narrow.
 *
 * Defensive throughout: this is parsed from a webhook body, and the shape
 * is whatever Meta sent.
 */
function failureReasons(errors: unknown): { code?: unknown; title?: unknown }[] {
  if (!Array.isArray(errors)) return [];
  return errors.map((e) => {
    const entry = (e ?? {}) as Record<string, unknown>;
    return { code: entry.code, title: entry.title };
  });
}

async function handleStatusUpdate(tenantId: string, item: NormalizedStatusItem): Promise<void> {
  const ourStatus = META_STATUS_MAP[item.status];
  if (!ourStatus) {
    logger.debug({ status: item.status }, 'Ignoring unrecognized Meta message status');
    return;
  }

  // A failure arrives here and NOWHERE else. Meta accepts the send with a
  // 200 and its message id, then decides minutes later that it will not
  // deliver it — an unconfigured account currency, a template still in
  // review, a per-user marketing cap. Until this log existed, the only
  // trace was an `error` field on a row nobody reads, and the invitation
  // messages are internal, so not even the agent saw a red tick. "Meta
  // accepted it" and "the customer got it" are different claims, and this
  // is the line that tells them apart.
  if (item.status === 'failed') {
    logger.warn(
      { tenantId, messageId: item.messageId, reasons: failureReasons(item.errors) },
      'Meta refused to deliver a message it had already accepted — the customer did not receive it',
    );
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

  /**
   * A failed invitation stops hiding.
   *
   * The private-chat invitation is written `internal`, which keeps it out
   * of the agent's thread — it is addressed to the customer and carries a
   * link the agent cannot use, and a bubble full of that between the
   * customer's message and the reply helped nobody.
   *
   * That is right while it works. When it does NOT, hiding it is how an
   * agent ends up believing a customer was given the link when they were
   * never given anything: Meta accepts the send with a 200, the app says
   * "Invitation sent", and the refusal arrives seconds later in a webhook
   * nobody watches. It happened for a whole morning.
   *
   * So a failure un-hides the message. It appears in the thread as a red
   * bubble carrying Meta's reason, which is exactly where somebody will
   * see it, and the reply beneath it is the next thing they were going to
   * write anyway.
   */
  const surfaced = ourStatus === 'FAILED' && message.internal === true;
  if (surfaced) {
    await revealInternalMessage(String(message._id), tenantId);
    message.internal = false;

    // And the invitation goes back on the shelf.
    //
    // The cap counts how many times this customer has been ASKED to move
    // to the private chat, and one that never reached their phone asked
    // them nothing. Counting it anyway is how a workspace spent its single
    // allowed invitation on a message the customer never saw — and then
    // sent nothing on their next message either, because the counter said
    // the job was done. Which is exactly what happened here for a whole
    // morning while Meta refused every one of them over billing.
    //
    // So the next inbound message tries again, and keeps trying until one
    // actually lands. Once one does, the count stands and the customer is
    // not asked again.
    await refundInviteSent(String(message.conversationId), tenantId);
  }

  const realtime = getRealtimeEmitter();
  // Loaded before the emit rather than after: the status event now has to
  // be addressed to the conversation's number, so it needs the row anyway.
  const conversation = await findConversationByIdAndTenant(String(message.conversationId), tenantId);
  if (conversation) {
    if (surfaced) {
      // message:status would not do here: the app never received this
      // message in the first place, so there is no bubble for a status to
      // land on. It has to arrive as a new one.
      realtime.emitMessageNew(
        tenantId,
        toRealtimeMessage(message),
        String(conversation.whatsappPhoneNumberId),
      );
    } else {
      realtime.emitMessageStatus(
        tenantId,
        String(message.conversationId),
        String(message._id),
        ourStatus,
        String(conversation.whatsappPhoneNumberId),
      );
    }
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

  /**
   * What actually arrived.
   *
   * The happy path was the only one that logged nothing. A bad signature,
   * an unknown number, a failed job — each says so; a delivery that
   * worked said nothing at all, which made "did the customer's message
   * reach us?" unanswerable from the logs. Hours went into inferring it
   * from response sizes and the absence of other lines.
   *
   * Identifiers and fixed enums only — no message text, which is a
   * customer's words and does not belong in a log aggregator.
   */
  logger.info(
    {
      tenantId,
      kind: item.kind,
      messageType: item.kind === 'message' ? item.messageType : undefined,
      phoneNumberId: item.phoneNumberId,
      displayPhoneNumber: phoneNumberDoc.displayPhoneNumber,
    },
    'Meta webhook item accepted',
  );

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
