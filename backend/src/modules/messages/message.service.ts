import { ApiError } from '../../lib/ApiError';
import { recordAudit } from '../audit/auditLog.service';
import {
  findConversationByIdAndTenant,
  isWithinCustomerServiceWindow,
  markConversationPreviewRevoked,
  recordOutboundActivity,
} from '../conversations/conversation.repository';
import { findContactByIdAndTenant } from '../contacts/contact.repository';
import {
  createMessage,
  findMessageByIdAndTenant,
  findMessageByClientId,
  attachMetaMessageId,
  markMessageFailed,
  softDeleteMessage,
  revokeMessage,
  countWhatsAppNudges,
  setMessageStarred,
} from './message.repository';
import { findMediaByIdAndTenant } from '../media/media.repository';
import { resolveMetaCredentialsForPhoneNumber, type ResolvedMetaCredentials } from '../whatsapp/whatsapp.service';
import { markConnectionExpired } from '../whatsapp/embeddedSignup.service';
import { getMetaGateway, toMetaApiError, MetaApiError, type SendableMediaType } from '../../integrations/meta';
import { mockMetaGateway } from '../../integrations/meta/mock/mockMetaGateway';
import { getRealtimeEmitter } from '../../realtime/events';
import { trace, type PerfTrace } from '../../lib/perfTrace';
import { toRealtimeMessage, toRealtimeConversation } from '../../realtime/serializers';
import type { MessageDoc, MessageLean } from './message.model';
import { refusalToRevoke, REVOKE_REFUSAL_MESSAGE } from './messageRevoke';
import { toWhatsAppId } from '../../lib/phone';
import { findActiveSessionForConversation } from '../guest/guestSession.repository';
import { resolveReplyChannel } from '../guest/webChatRouting';
import {
  countsAgainstNudgeQuota,
  nudgeWindowStart,
  NUDGE_QUOTA_MESSAGE,
  WHATSAPP_NUDGE_LIMIT,
} from './whatsappQuota';
import { pushGuestMessage } from '../guest/guestPush.service';
import { resolveBusinessNameForConversation } from '../guest/businessName';
import type { ConversationDoc } from '../conversations/conversation.model';
import type { ContactDoc } from '../contacts/contact.model';

/**
 * Message types this service can actually dispatch through the Meta
 * gateway today. Deliberately narrower than the full Message.type enum
 * (which also covers inbound-only/receive-side types like location,
 * contacts, sticker) — spec §20 forbids claiming unsupported
 * functionality, so anything outside this list is rejected explicitly
 * rather than silently mishandled. `reaction` IS included: Meta's Cloud
 * API genuinely supports sending one (spec §51 — Meta's docs win).
 */
export type SendableMessageType = 'text' | 'template' | 'reaction' | 'location' | SendableMediaType;

export interface SendOutboundMessageInput {
  tenantId: string;
  conversationId: string;
  /**
   * The agent who sent this, when a person did.
   *
   * Optional because not every outbound message has an author: the
   * automatic private-chat link (see guestAutoReply.service.ts) is sent by
   * the system, and stamping an agent's id on it would put their name on a
   * message they never wrote — the agent app reads this field to decide
   * whose bubble it is.
   */
  senderId?: string;
  type: SendableMessageType;
  text?: string;
  mediaId?: string; // our Media._id — must already be uploaded to Meta (has metaMediaId)
  mediaLink?: string; // alternative to mediaId: a public HTTPS URL
  caption?: string;
  filename?: string;
  templateName?: string;
  languageCode?: string;
  templateComponents?: unknown[];
  replyToMessageId?: string; // our Message._id — quotes another message when sending text/media
  reactToMessageId?: string; // our Message._id — the target of a `type: 'reaction'` send
  emoji?: string; // '' removes a previously-sent reaction (real, documented Meta behavior)
  /** Where a `type: 'location'` send points. name/address are captions Meta draws under the pin. */
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  /**
   * Sent by the system, and kept out of the workspace's own view of the
   * thread. Only the automatic private-chat invitation sets it — see
   * message.model.ts for why it is hidden rather than not stored.
   */
  internal?: boolean;
  /**
   * The client's own id for this send, stable across its retries.
   *
   * Turns a retry into a lookup: without it, a send that succeeded and
   * whose response was lost comes back as a second message the customer
   * has already received.
   */
  clientMessageId?: string;
  /**
   * The conversation, when the caller already has it.
   *
   * Every HTTP send arrives through requireVisibleConversation, which has
   * just loaded this exact document to decide the caller may see it.
   * Re-reading it here was a round trip to Mumbai for something already
   * in memory. Optional so the non-HTTP callers (the auto-reply, the
   * tests) stay unchanged — they simply pay the read.
   */
  conversation?: ConversationDoc;
}

/**
 * Full outbound send flow (spec §17): tenant/permission checks happen at
 * the route layer before this is called; this function owns the 24-hour
 * customer-service-window check (§18), the Meta API call with idempotency-
 * safe status tracking, and persisting the result. Route wiring (POST
 * /api/conversations/:id/messages) lands in Phase 5 — this is the service
 * that route will call.
 */
/**
 * Removes a message, for this workspace or for both sides.
 *
 * 'me' hides it from the shared inbox and nothing more — the customer's
 * copy is untouched, whichever channel it went out on.
 *
 * 'everyone' genuinely withdraws it, and is possible only on the private
 * web chat. Meta's Cloud API exposes no delete or recall, so a WhatsApp
 * message that has been delivered cannot be taken back; offering it there
 * would clear the message here while the customer still had it on their
 * phone, which is worse than not offering it at all. messageRevoke.ts
 * holds that rule and the rest of them.
 */
export async function deleteMessageForTenant(
  tenantId: string,
  conversationId: string,
  messageId: string,
  scope: 'me' | 'everyone' = 'me',
  /** Whoever pressed it, for the audit entry a revoke leaves behind. */
  actorUserId?: string,
): Promise<void> {
  const message = await findMessageByIdAndTenant(messageId, tenantId);
  if (!message || String(message.conversationId) !== conversationId) {
    throw ApiError.notFound('MESSAGE_NOT_FOUND', 'That message does not exist.');
  }

  if (scope === 'me') {
    await softDeleteMessage(messageId, tenantId);
    return;
  }

  const refusal = refusalToRevoke(message, 'agent');
  if (refusal) {
    throw ApiError.badRequest(`REVOKE_${refusal}`, REVOKE_REFUSAL_MESSAGE[refusal]);
  }

  const applied = await revokeAndBroadcast(tenantId, conversationId, messageId, 'agent');

  // Who withdrew what, and when. The tombstone deliberately says only
  // "you" — this is a shared inbox and naming a colleague on a bubble
  // everyone can see is not the bubble's job — so this is the record
  // that answers the question when it is actually asked. The content is
  // NOT recorded: writing it here would keep a copy of exactly the thing
  // the delete was meant to remove.
  if (applied && actorUserId) {
    await recordAudit({
      tenantId,
      actorUserId,
      action: 'message.revoke',
      targetType: 'Message',
      targetId: messageId,
      metadata: { conversationId },
    });
  }
}

/**
 * Withdraws a message and tells everyone looking at it.
 *
 * Shared by the agent-side delete above and the customer's own, in
 * guest.service.ts, because the fan-out is the part that is easy to do
 * half of: the bubble has to become a tombstone on both sides, the chat
 * list has to stop previewing text that no longer exists, and both have
 * to happen whichever side pressed the button.
 *
 * Returns false when the message was already gone — a second tap, or the
 * other side revoking it in the same moment. Not an error: what the
 * caller asked for is true either way.
 */
export async function revokeAndBroadcast(
  tenantId: string,
  conversationId: string,
  messageId: string,
  by: 'agent' | 'customer',
): Promise<boolean> {
  const revoked = await revokeMessage(messageId, tenantId, by);
  if (!revoked) return false;

  const conversation = await findConversationByIdAndTenant(conversationId, tenantId);
  if (!conversation) return true;
  const phoneNumberId = String(conversation.whatsappPhoneNumberId);

  // The chat list previews the last message's text, and that text is now
  // deleted — a list still showing it would be the one place the content
  // survived.
  const updated = await markConversationPreviewRevoked(conversationId, tenantId, revoked.createdAt);

  // One event to both audiences: agents are in the tenant and number
  // rooms, the customer's window is in the conversation room, and every
  // one of them has to replace the bubble with a tombstone.
  const emitter = getRealtimeEmitter();
  emitter.emitMessageUpdated(tenantId, toRealtimeMessage(revoked as unknown as MessageLean), phoneNumberId);
  if (updated) emitter.emitConversationUpdated(tenantId, toRealtimeConversation(updated));

  return true;
}

/**
 * Stars or unstars a message. Workspace-wide by design (see the model's
 * starredAt note) — the conversation check is what scopes it, exactly as
 * with delete, so a message id from another chat cannot be starred through
 * this conversation's route.
 */
export async function setMessageStarredForTenant(
  tenantId: string,
  conversationId: string,
  messageId: string,
  starred: boolean,
): Promise<MessageDoc> {
  const message = await findMessageByIdAndTenant(messageId, tenantId);
  if (!message || String(message.conversationId) !== conversationId) {
    throw ApiError.notFound('MESSAGE_NOT_FOUND', 'That message does not exist.');
  }
  const updated = await setMessageStarred(messageId, tenantId, starred);
  if (!updated) {
    throw ApiError.notFound('MESSAGE_NOT_FOUND', 'That message does not exist.');
  }
  return updated;
}

export async function sendOutboundMessage(input: SendOutboundMessageInput): Promise<MessageDoc> {
  // SERVER_RECEIVED. Everything after this is ours to account for; what
  // came before it is the client and the network, which the app's own
  // marks cover. See lib/perfTrace.ts — off unless PERF_TRACE=true.
  const perf = trace('message.send', { conversationId: input.conversationId, type: input.type });

  const conversation =
    input.conversation ?? (await findConversationByIdAndTenant(input.conversationId, input.tenantId));
  perf.mark(input.conversation ? 'conversation_reused' : 'conversation_read');
  if (!conversation) {
    throw ApiError.notFound('CONVERSATION_NOT_FOUND', 'Conversation not found');
  }

  /**
   * Four independent reads, one round trip.
   *
   * They used to run one after another, each awaited before the next was
   * issued, and none of them needs anything the others return — only the
   * contact needs the conversation, which is already in hand. Against a
   * database ~235 ms away that ordering alone cost most of a second
   * before the message was even written, and the customer's window was
   * waiting on all of it: measured in production, a reply took 2.1 s to
   * leave the server, on a socket that then delivered it in milliseconds.
   *
   * The reply target is fetched here too. It is only read on the WhatsApp
   * path, but a query that runs beside three others adds no wall time,
   * where the same query in sequence adds a full round trip.
   */
  const [contact, alreadySent, session, replyTarget] = await Promise.all([
    findContactByIdAndTenant(String(conversation.contactId), input.tenantId),
    input.clientMessageId
      ? findMessageByClientId(input.tenantId, input.clientMessageId)
      : Promise.resolve(null),
    findActiveSessionForConversation(input.conversationId, input.tenantId),
    input.replyToMessageId
      ? findMessageByIdAndTenant(input.replyToMessageId, input.tenantId)
      : Promise.resolve(null),
  ]);
  // One mark for all four: they ran together, so four numbers would be
  // four readings of the same round trip.
  perf.mark('parallel_reads');

  if (!contact) {
    throw ApiError.notFound('CONTACT_NOT_FOUND', 'Contact not found');
  }

  /**
   * Already sent under this id — hand back what was stored rather than
   * sending it again.
   *
   * This is the retry case, not the double-tap case: the app's outbox
   * retries a send it never got a response to, and it cannot tell that
   * apart from one that never arrived. Returning the existing message
   * makes the retry a no-op the client can treat as success, which is
   * exactly what it is.
   *
   * The unique index on (tenantId, clientMessageId) is what makes this
   * airtight — this lookup handles the common case cheaply, and the index
   * catches two retries arriving at the same instant, where both would
   * pass this check.
   *
   * Checked after the batch above rather than before it: the other three
   * reads are harmless on a duplicate, and they are free here because
   * they ran alongside this one.
   */
  if (alreadySent) return alreadySent;

  // A demo contact is a local sandbox: the number is not on WhatsApp, so
  // neither the window rule nor a real send means anything on it. Both are
  // bypassed together on purpose — bypassing only the window would leave a
  // composer that opens and then fails at Meta instead, which is worse than
  // the template prompt it replaced. See contact.model.ts.
  const isDemoContact = contact.isDemo === true;

  /**
   * Where this reply actually goes.
   *
   * Decided here, on the server, rather than by whichever client is
   * composing. A customer sitting in the private window was receiving
   * every reply twice — once over the socket into the window, once
   * through Meta into WhatsApp — because both halves ran and nothing
   * chose between them. The clients each had their own idea of when to
   * use the web window, which meant three places to get it right and one
   * customer to receive the consequences.
   *
   * Nothing about the WhatsApp connection changes: inbound webhooks,
   * credentials and the 24-hour window are all untouched. This only
   * decides which way an outbound message leaves.
   */
  const channel = resolveReplyChannel({
    messageType: input.type,
    isDemoContact,
    session,
  });

  // Delivered into the window the customer is actually reading, and not
  // to Meta at all. Its own path because none of what follows applies:
  // there is no gateway to call, no Meta id to attach, and no 24-hour
  // window to enforce — that rule is Meta's, and this message never
  // reaches them.
  if (channel === 'web') {
    return deliverToWebChat(input, conversation, contact, perf);
  }

  // Server-side 24h window enforcement — never trust an Android countdown.
  if (!isDemoContact && input.type !== 'template' && !isWithinCustomerServiceWindow(conversation)) {
    throw new ApiError(
      422,
      'MESSAGE_TEMPLATE_REQUIRED',
      'An approved WhatsApp template is required.',
    );
  }

  /**
   * The WhatsApp allowance.
   *
   * Everything reaching here is going out through Meta, which means the
   * customer has not opened their private window — so this is one of the
   * few nudges the workspace gets before the only way through is that
   * link. See whatsappQuota.ts for what is counted and why.
   *
   * Refused rather than stored as FAILED: nothing was sent and nothing
   * was attempted, so a row claiming otherwise would put a failed bubble
   * in the thread for a message that never existed. The client's own
   * retry then works unchanged the moment the customer opens their link,
   * because by then replies route to the window and never reach this
   * check at all.
   *
   * Counted after the 24-hour check, deliberately: a closed window is the
   * more specific problem and has its own fix (a template), and reporting
   * the allowance first would send someone to the wrong one.
   */
  if (countsAgainstNudgeQuota({ messageType: input.type, internal: input.internal, isDemoContact })) {
    const used = await countWhatsAppNudges(
      input.tenantId,
      input.conversationId,
      nudgeWindowStart(session),
    );
    perf.mark('nudge_quota_read');
    if (used >= WHATSAPP_NUDGE_LIMIT) {
      throw new ApiError(422, 'WHATSAPP_NUDGE_LIMIT_REACHED', NUDGE_QUOTA_MESSAGE);
    }
  }

  const replyToMetaMessageId = replyTarget?.metaMessageId ?? undefined;

  // Our own row is created before calling Meta (status QUEUED) so a
  // mid-flight crash never loses the attempt — see markMessageFailed below.
  // A reaction's row links to its target via replyToMessageId (same field
  // a reply uses) — see realtime/serializers.ts / the mobile client for how
  // that's read back to attach the reaction badge to the right bubble.
  const localMessage = await createMessageTraced(perf, {
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    senderId: input.senderId,
    recipientPhone: contact.phone,
    direction: 'OUT',
    // Recorded now, while the routing decision is still the true one —
    // see the model's `channel` note. This branch is the Meta one, so
    // this message can never be unsent.
    channel: 'whatsapp',
    type: input.type,
    text:
      input.type === 'reaction'
        ? input.emoji
        : input.type === 'template'
          ? `Template: ${input.templateName}`
          : input.text,
    // Stored so the pin survives a reload. Without it the message comes
    // back as a bare "location" with no coordinates, and both clients
    // fall through to the sentence they show for one they cannot draw.
    location: input.location,
    mediaId: input.mediaId,
    replyToMessageId: input.type === 'reaction' ? input.reactToMessageId : input.replyToMessageId,
    status: 'QUEUED',
    internal: input.internal,
    clientMessageId: input.clientMessageId,
  });

  // Declared outside the try so the catch can name the connection that
  // failed; it is still undefined if resolution itself threw.
  let credentialsUsed: ResolvedMetaCredentials | undefined;

  try {
    const credentials = await resolveMetaCredentialsForPhoneNumber(
      input.tenantId,
      String(conversation.whatsappPhoneNumberId),
    );
    credentialsUsed = credentials;
    // Demo sends never leave this server, whatever META_MOCK_MODE is set to.
    const gateway = isDemoContact ? mockMetaGateway : getMetaGateway();

    // Digits without the plus — the form Meta's own webhook uses for this
    // customer. Contacts are stored canonically (+E.164), so sending the
    // stored string verbatim would put a `+` on the wire for every contact
    // once the duplicate merge has canonicalised them.
    const metaMessageId = await dispatch(
      gateway,
      credentials,
      toWhatsAppId(contact.phone),
      input,
      replyToMetaMessageId,
    );
    // The Meta round trip, which is why the WhatsApp path can never be as
    // quick as the web one: this is a call to someone else's servers, and
    // the message does not exist for them until it returns.
    perf.mark('meta_dispatch');

    const sentMessage = await attachMetaMessageId(String(localMessage._id), input.tenantId, metaMessageId);

    const realtime = getRealtimeEmitter();
    /**
     * The chat row and the socket both skip a system message.
     *
     * Hiding the bubble but leaving the invitation as the row's "last
     * message" — and pushing it live into an open thread — would show the
     * agent the very thing the bubble was hidden to spare them, in two
     * more places. The conversation's own timestamps are unaffected
     * either way; what is skipped is the preview text and the push.
     */
    if (!input.internal) {
      // Before the conversation row is touched, not after. Nobody is
      // waiting on a preview string; the people on this thread are
      // waiting on the message, and putting a write in front of the emit
      // held it back by a full round trip for no one's benefit.
      realtime.emitMessageNew(
        input.tenantId,
        toRealtimeMessage(sentMessage ?? localMessage),
        String(conversation.whatsappPhoneNumberId),
      );
      // SOCKET_EMIT_RECEIVER. The receiver's device has the message from
      // here; everything below is bookkeeping, and the trace ends now so
      // the total is the number that matters.
      perf.mark('emit');
      perf.end({ messageId: String(localMessage._id), channel: 'whatsapp' });

      const updatedConversation = await recordOutboundActivity(
        input.conversationId,
        input.tenantId,
        input.text ?? input.caption ?? `[${input.type}]`,
        new Date(),
        // SENT, matching the message row attachMetaMessageId just wrote
        // — a status webhook advances both from here.
        'SENT',
        String(localMessage._id),
      );
      if (updatedConversation) {
        realtime.emitConversationUpdated(input.tenantId, toRealtimeConversation(updatedConversation));
      }
    }

    return sentMessage ?? localMessage;
  } catch (err) {
    const serialized = err instanceof Error ? { name: err.name, message: err.message } : err;
    await markMessageFailed(String(localMessage._id), input.tenantId, serialized);

    // Meta rejected the credentials — an expired or revoked token. Recorded
    // on the connection so the app can say "reconnect your WhatsApp"
    // instead of showing a failed message with no explanation, on this
    // send and every one after it.
    if (err instanceof MetaApiError && err.code === 'META_AUTH_ERROR' && credentialsUsed) {
      await markConnectionExpired(credentialsUsed.whatsappAccountId);
      throw ApiError.badRequest(
        'WHATSAPP_RECONNECT_REQUIRED',
        'Your WhatsApp connection has expired. Open Settings → Connect WhatsApp and connect again.',
      );
    }

    if (err instanceof ApiError) throw err;
    throw toMetaApiError(err);
  }
}

/**
 * An outbound message delivered into the customer's private window.
 *
 * Written SENT rather than QUEUED: there is no gateway to wait on, and
 * the socket carries it in the same tick. A QUEUED row would sit there
 * forever waiting for a Meta status webhook that is never coming.
 *
 * No Meta id is attached for the same reason — this message does not
 * exist on Meta's side, and inventing an id for it would make every
 * later status lookup lie.
 */
/**
 * The insert, timed on its own.
 *
 * Its own function because it is the one database call the delivery
 * genuinely cannot start without, so it is the floor every other
 * optimisation is measured against — worth being able to read straight
 * off the log line rather than inferring it from a total.
 */
async function createMessageTraced(
  perf: PerfTrace,
  input: Parameters<typeof createMessage>[0],
): Promise<MessageDoc> {
  const message = await createMessage(input);
  perf.mark('db_insert');
  return message;
}

async function deliverToWebChat(
  input: SendOutboundMessageInput,
  conversation: ConversationDoc,
  contact: ContactDoc,
  perf: PerfTrace,
): Promise<MessageDoc> {
  const message = await createMessageTraced(perf, {
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    senderId: input.senderId,
    recipientPhone: contact.phone,
    direction: 'OUT',
    // This app's own channel on both ends, which is what makes delete
    // for everyone possible here and nowhere else.
    channel: 'web',
    type: input.type,
    text:
      input.type === 'reaction'
        ? input.emoji
        : input.type === 'template'
          ? `Template: ${input.templateName}`
          : input.text,
    // Stored so the pin survives a reload. Without it the message comes
    // back as a bare "location" with no coordinates, and both clients
    // fall through to the sentence they show for one they cannot draw.
    location: input.location,
    mediaId: input.mediaId,
    replyToMessageId: input.type === 'reaction' ? input.reactToMessageId : input.replyToMessageId,
    status: 'SENT',
    internal: input.internal,
    clientMessageId: input.clientMessageId,
  });

  /**
   * The socket, first, and nothing before it.
   *
   * This is the whole point of the web channel: the customer's window is
   * already connected and the event reaches it in milliseconds. Every
   * await placed above this line is time that window spends showing
   * nothing — and the two that used to sit here (the conversation row,
   * then the push) added the better part of a second to a message that
   * was already written and final.
   *
   * Nothing below needs to happen first. The row's preview is for the
   * agent's own chat list, and the push is for a window that is NOT open;
   * neither is a precondition for delivering to one that is.
   */
  const realtime = getRealtimeEmitter();
  realtime.emitMessageNew(
    input.tenantId,
    toRealtimeMessage(message),
    String(conversation.whatsappPhoneNumberId),
  );
  // SOCKET_EMIT_RECEIVER — the customer's window has it from here.
  perf.mark('emit');
  perf.end({ messageId: String(message._id), channel: 'web' });

  const updatedConversation = await recordOutboundActivity(
    input.conversationId,
    input.tenantId,
    input.text ?? input.caption ?? `[${input.type}]`,
    new Date(),
    'SENT',
    String(message._id),
  );
  if (updatedConversation) {
    realtime.emitConversationUpdated(input.tenantId, toRealtimeConversation(updatedConversation));
  }

  // The customer's own browser, for the tab that is closed or frozen.
  // This is what makes web-only routing safe: without it, a customer who
  // backgrounded the window would simply never learn a reply had arrived,
  // and WhatsApp is no longer carrying it for them.
  //
  // Not awaited, and never allowed to fail the send. It is a notification
  // for a window that is not watching, so nothing — not the customer's
  // socket, not the agent's response — has any reason to wait on a name
  // lookup and a round trip to Google before it completes. The catch is
  // what keeps an FCM hiccup from surfacing as "message not sent".
  void (async () => {
    const businessName = (
      await resolveBusinessNameForConversation(
        input.tenantId,
        String(conversation.whatsappPhoneNumberId),
      )
    ).name;
    await pushGuestMessage({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      businessName,
      messageType: input.type === 'text' ? 'text' : 'media',
      text: input.text,
    });
  })().catch(() => {
    // Deliberately swallowed; see above.
  });

  return message;
}

async function dispatch(
  gateway: ReturnType<typeof getMetaGateway>,
  credentials: Awaited<ReturnType<typeof resolveMetaCredentialsForPhoneNumber>>,
  toPhone: string,
  input: SendOutboundMessageInput,
  replyToMetaMessageId: string | undefined,
): Promise<string> {
  switch (input.type) {
    case 'text': {
      if (!input.text) throw ApiError.badRequest('TEXT_REQUIRED', 'text is required for a text message');
      const result = await gateway.sendText(credentials, { to: toPhone, text: input.text, replyToMetaMessageId });
      return result.metaMessageId;
    }
    case 'template': {
      if (!input.templateName || !input.languageCode) {
        throw ApiError.badRequest('TEMPLATE_REQUIRED', 'templateName and languageCode are required');
      }
      const result = await gateway.sendTemplate(credentials, {
        to: toPhone,
        templateName: input.templateName,
        languageCode: input.languageCode,
        components: input.templateComponents as never,
      });
      return result.metaMessageId;
    }
    case 'image':
    case 'video':
    case 'audio':
    case 'document': {
      if (!input.mediaId && !input.mediaLink) {
        throw ApiError.badRequest('MEDIA_REQUIRED', 'mediaId or mediaLink is required');
      }
      let metaMediaId: string | undefined;
      if (input.mediaId) {
        const mediaDoc = await findMediaByIdAndTenant(input.mediaId, input.tenantId);
        if (!mediaDoc?.metaMediaId) {
          throw ApiError.badRequest('MEDIA_NOT_UPLOADED', 'This media has not finished uploading to Meta yet');
        }
        metaMediaId = mediaDoc.metaMediaId;
      }
      const result = await gateway.sendMedia(credentials, {
        to: toPhone,
        mediaType: input.type,
        mediaId: metaMediaId,
        link: input.mediaLink,
        caption: input.caption,
        filename: input.filename,
        replyToMetaMessageId,
      });
      return result.metaMessageId;
    }
    case 'location': {
      if (!input.location) {
        throw ApiError.badRequest('LOCATION_REQUIRED', 'latitude and longitude are required');
      }
      const result = await gateway.sendLocation(credentials, {
        to: toPhone,
        latitude: input.location.latitude,
        longitude: input.location.longitude,
        name: input.location.name,
        address: input.location.address,
        replyToMetaMessageId,
      });
      return result.metaMessageId;
    }
    case 'reaction': {
      if (!input.reactToMessageId || input.emoji === undefined) {
        throw ApiError.badRequest('REACTION_REQUIRED', 'reactToMessageId and emoji are required');
      }
      const target = await findMessageByIdAndTenant(input.reactToMessageId, input.tenantId);
      if (!target?.metaMessageId) {
        throw ApiError.badRequest(
          'REACTION_TARGET_NOT_SENT',
          'Cannot react to a message that has not been delivered by Meta yet',
        );
      }
      const result = await gateway.sendReaction(credentials, {
        to: toPhone,
        reactToMetaMessageId: target.metaMessageId,
        emoji: input.emoji,
      });
      return result.metaMessageId;
    }
    default:
      throw ApiError.badRequest('UNSUPPORTED_MESSAGE_TYPE', `Cannot send message type "${input.type as string}"`);
  }
}
