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
  softDeleteMessage,
  revokeMessage,
  countWhatsAppNudges,
  countTemplatesSinceCustomerMessage,
  setMessageStarred,
} from './message.repository';
import { type SendableMediaType } from '../../integrations/meta';
import { getRealtimeEmitter } from '../../realtime/events';
import { trace, type PerfTrace } from '../../lib/perfTrace';
import { toRealtimeMessage, toRealtimeConversation } from '../../realtime/serializers';
import type { MessageDoc, MessageLean } from './message.model';
import { refusalToRevoke, REVOKE_REFUSAL_MESSAGE } from './messageRevoke';
import { dispatchAndFinalize } from './metaDispatch';
import { trySlotForDispatch } from '../whatsapp/sendPacing';
import { enqueueOutboundDispatch } from '../../queues/outboundDispatch.queue';
import { findActiveSessionForConversation } from '../guest/guestSession.repository';
import { resolveReplyChannel } from '../guest/webChatRouting';
import {
  countsAgainstNudgeQuota,
  nudgeWindowStart,
  nudgeQuotaMessage,
} from './whatsappQuota';
import { pushGuestMessage } from '../guest/guestPush.service';
import { resolveBusinessNameForConversation } from '../guest/businessName';
import type { ConversationDoc } from '../conversations/conversation.model';
import type { ContactDoc } from '../contacts/contact.model';
import { logger } from '../../lib/logger';
import {
  CONTENT_POLICY_CODE,
  CONTENT_POLICY_MESSAGE,
  findPolicyViolationInSend,
} from './contentPolicy';
import { nudgePolicyFor } from './nudgePolicy';
import { nudgeAt, nudgeRefusalMessage, sameNudgeText } from './nudgeTemplates';

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
  /**
   * Which of the workspace's set WhatsApp messages this is.
   *
   * Only meaningful while the customer is outside their private window,
   * where the wording is fixed (nudgeTemplates.ts). Naming the nudge by
   * position rather than posting its text back means a client one
   * version behind still sends what the admin set today, and that an
   * agent editing the box cannot turn it into something else.
   *
   * Optional: sending the exact text works too, so a client that does
   * not know about this field is not broken by it.
   */
  nudgeIndex?: number;
  replyToMessageId?: string; // our Message._id — quotes another message when sending text/media
  reactToMessageId?: string; // our Message._id — the target of a `type: 'reaction'` send
  emoji?: string; // '' removes a previously-sent reaction (real, documented Meta behavior)
  /** Where a `type: 'location'` send points. name/address are captions Meta draws under the pin. */
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  /**
   * Sent by the system, and kept out of the workspace's own view of the
   * thread. Only the automatic private-chat invitation sets it — see
   * message.model.ts for why it is hidden rather than not stored.
   *
   * No longer exempts a send from the nudge allowance or its content
   * rules by itself — see the comment above the quota check in
   * sendOutboundMessage. Use `exemptFromNudgeWording` for the one thing
   * that invitation specifically still needs exempted.
   */
  internal?: boolean;
  /** Set only by messageRetry.queue.ts when resending after a Meta rate-limit refusal — see the schema. */
  rateLimitRetryAttempt?: number;
  /**
   * Allows THIS send's own text past the exact-wording check that applies
   * while nudge enforcement is on — never past the count.
   *
   * Set only by the automatic private-chat invitation's text and
   * fallback-text sends. Its wording is an admin setting of its own
   * (Automatic replies, not WhatsApp Nudges) and carries the actual link
   * — the substitution the wording check performs ("the stored [nudge]
   * wording wins over whatever arrived") would silently replace that
   * link with unrelated nudge text, which is a worse failure than simply
   * not delivering. The budget itself is never bypassed: the count check
   * above throws before this is ever reached.
   */
  exemptFromNudgeWording?: boolean;
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

  /**
   * Platform content policy, before anything is read, stored or sent.
   *
   * Placed above the channel decision on purpose: this is the one check
   * that must hold on BOTH sides of it. Putting it after would leave the
   * private window — the branch that never reaches Meta — as the way
   * around it, which would make this a way of hiding the activity rather
   * than a rule against it. See contentPolicy.ts.
   *
   * Internal notes are exempt: they are staff-to-staff, never delivered
   * to the customer and never sent to Meta, so nothing leaves the
   * platform in the workspace's name. An agent recording what a customer
   * said to them is exactly the note this should not eat.
   */
  if (!input.internal) {
    const violation = findPolicyViolationInSend(input);
    if (violation) {
      // The matched terms, not the message: enough to tune the list and
      // to show an admin why, without copying a customer conversation
      // into the logs.
      logger.warn(
        {
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          rule: violation.rule,
          terms: violation.terms,
        },
        'Outbound message refused by the platform content policy',
      );
      throw new ApiError(422, CONTENT_POLICY_CODE, CONTENT_POLICY_MESSAGE);
    }
  }

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

  /**
   * A nudge has nowhere to go once the customer has arrived.
   *
   * The fixed WhatsApp messages exist for one purpose: to move a customer
   * into their private window. Delivered INTO that window they are an
   * absurdity — the customer sits in the private chat and is told to click
   * the link to the private chat — and that is exactly what happened,
   * because the web branch below runs before every WhatsApp rule and this
   * one is not a WhatsApp rule at all.
   *
   * Refused rather than quietly re-routed: the agent tapped a card that
   * should not have been on screen, and being told so is what stops them
   * tapping it again. The composer withdraws the card as soon as it knows,
   * so this is the backstop for a client whose copy is out of date.
   */
  if (channel === 'web' && typeof input.nudgeIndex === 'number') {
    throw new ApiError(
      422,
      'NUDGE_NOT_NEEDED',
      'This customer is already in the private chat — just reply to them here.',
    );
  }

  // Delivered into the window the customer is actually reading, and not
  // to Meta at all. Its own path because none of what follows applies:
  // there is no gateway to call, no Meta id to attach, and no 24-hour
  // window to enforce — that rule is Meta's, and this message never
  // reaches them.
  if (channel === 'web') {
    return deliverToWebChat(input, conversation, contact, perf);
  }

  /**
   * Whether the customer wrote to us in the last 24 hours.
   *
   * Read once and reused, because two separate rules below turn on it and
   * they must agree: the one that demands a template when it is shut, and
   * the one that fixes the wording when it is shut. Computed twice, a
   * conversation whose window expired between the two calls would be told
   * both that a template is required and that only free-form nudge text
   * may be sent.
   */
  const withinCustomerServiceWindow = isWithinCustomerServiceWindow(conversation);

  // Server-side 24h window enforcement — never trust an Android countdown.
  if (!isDemoContact && input.type !== 'template' && !withinCustomerServiceWindow) {
    throw new ApiError(
      422,
      'MESSAGE_TEMPLATE_REQUIRED',
      'An approved WhatsApp template is required.',
    );
  }

  /**
   * At most one agent-picked template per stretch of the customer not
   * writing back.
   *
   * Meta accepts a template send up front and only refuses it minutes
   * later, over the status webhook — a rate limit, a quality cap, a
   * payment issue. None of that is visible at send time, so an agent who
   * tapped "Use a template" and saw it go out as normal had no reason not
   * to try again, and each retry landed inside the same cooldown Meta was
   * enforcing and failed the same way — the exact burst this exists to
   * stop. Scoped to since the customer's own last message, not forever:
   * the moment they write back the slate is clean and a fresh template is
   * a legitimate thing to send, if the 24-hour window has since closed
   * again.
   *
   * Exempt: a demo contact (not a real Meta send) and `internal` sends —
   * the automatic private-chat invitation has its own configurable cap
   * (guestAutoReply.service.ts's maxSends) and this must not narrow it.
   */
  if (!isDemoContact && input.type === 'template' && !input.internal) {
    const alreadySentTemplates = await countTemplatesSinceCustomerMessage(
      input.tenantId,
      input.conversationId,
      conversation.lastCustomerMessageAt ?? null,
    );
    if (alreadySentTemplates > 0) {
      throw new ApiError(
        422,
        'TEMPLATE_ALREADY_SENT',
        'A template has already been sent to this customer since their last reply. Wait for them to write back before sending another.',
      );
    }
  }

  /**
   * The WhatsApp allowance.
   *
   * Everything reaching here is going out through Meta, which means the
   * customer has not opened their private window — so this is one of the
   * few nudges the workspace gets before the only way through is that
   * link. See whatsappQuota.ts for what is counted and why — including
   * why a customer who wrote to us within the last 24 hours is counted
   * too, not exempted: the private chat link is the one way through,
   * on purpose, whether or not Meta's own window happens to be open.
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
   *
   * Exempts `internal` sends — the automatic private-chat invitation
   * (guestAutoReply.service.ts) is the one caller that sets it. Its own
   * `maxSends` already caps how many times it fires; spending one of the
   * agent's own `WHATSAPP_NUDGE_LIMIT` slots on a send no agent chose to
   * make left a workspace that set "2 nudges" with an actual agent
   * budget of 1 the moment the invitation fired first. See
   * whatsappQuota.ts for the rest of what counts and why.
   */
  if (countsAgainstNudgeQuota({ messageType: input.type, isDemoContact, internal: input.internal })) {
    const [used, policy] = await Promise.all([
      countWhatsAppNudges(input.tenantId, input.conversationId, nudgeWindowStart(session)),
      nudgePolicyFor(input.tenantId),
    ]);
    perf.mark('nudge_quota_read');
    if (used >= policy.limit) {
      throw new ApiError(422, 'WHATSAPP_NUDGE_LIMIT_REACHED', nudgeQuotaMessage(policy.limit));
    }

    /**
     * WHAT may be said, not just how often.
     *
     * The count above is the weaker half of this rule. Free-form WhatsApp
     * messages to a customer who has not engaged are what Meta's policy
     * reviewers act on, and the cost of one agent improvising is the
     * whole business account — every number on it. So while the customer
     * is still outside their private window, the wording is the
     * workspace's to set and not the agent's to choose.
     *
     * The client may name the nudge by index or simply send its text;
     * both resolve to the same stored wording, and anything else is
     * refused. Matching ignores whitespace only, because a text box
     * round-trips newlines and trailing spaces without changing a single
     * thing the customer reads — see sameNudgeText.
     *
     * Media, location and everything that is not a plain text message are
     * refused outright here: there is no approved wording for them, and a
     * photo is exactly the kind of unsolicited content this is guarding
     * against.
     *
     * An approved template is the one exception. Meta approved its text
     * before it could be used at all, so there is no improvising left to
     * prevent — and the branch below rewrites the send into plain text,
     * which outside the window is the one thing Meta will not deliver. An
     * agent sending a template used to be refused here and told to "use
     * the suggested wording", naming something that could not legally go
     * out in its place.
     */
    if (policy.enforced && input.type !== 'template' && !input.exemptFromNudgeWording) {
      const expected = nudgeAt(policy.nudges, used);
      if (!expected) {
        throw new ApiError(422, 'WHATSAPP_NUDGE_LIMIT_REACHED', nudgeQuotaMessage(policy.limit));
      }

      const named = typeof input.nudgeIndex === 'number' && input.nudgeIndex === used;
      const matches = input.type === 'text' && typeof input.text === 'string' && sameNudgeText(input.text, expected);
      if (!named && !matches) {
        throw new ApiError(
          422,
          'WHATSAPP_NUDGE_NOT_ALLOWED',
          nudgeRefusalMessage(used + 1, policy.limit),
        );
      }

      // The stored wording wins over whatever arrived, so a client that
      // is one version behind still sends what the admin set today.
      input = { ...input, type: 'text', text: expected };
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
    templateName: input.type === 'template' ? input.templateName : undefined,
    rateLimitRetryAttempt: input.rateLimitRetryAttempt,
  });

  /**
   * The global throughput gate, shared by every number's every send —
   * agent-typed, templated, the automatic invitation, all of it. A slot
   * taken here is a real send about to happen; see sendPacing.ts for what
   * it is counted against and why it exists at all (the incident this
   * whole mechanism is for: a number's real Meta throughput is nothing
   * like "as fast as this app can fire requests").
   *
   * A demo contact skips it outright — those never reach Meta, so pacing
   * them guards nothing and would just make the sandbox feel broken.
   *
   * No slot free does NOT mean refused. The row above already exists as
   * QUEUED — exactly the state a message sits in for the normal few
   * hundred milliseconds before Meta answers today — so handing it to the
   * paced dispatch queue instead of calling Meta inline is invisible to
   * the caller: same return shape, same eventual SENT/FAILED over the
   * socket, just a longer stretch of "still queued" while its turn comes.
   */
  const whatsappPhoneNumberId = String(conversation.whatsappPhoneNumberId);
  if (!isDemoContact && !(await trySlotForDispatch(whatsappPhoneNumberId, input.tenantId))) {
    await enqueueOutboundDispatch({
      tenantId: input.tenantId,
      messageId: String(localMessage._id),
      conversationId: input.conversationId,
      whatsappPhoneNumberId,
      isDemoContact,
      replyToMetaMessageId,
      dispatchInput: {
        type: input.type,
        text: input.text,
        mediaId: input.mediaId,
        mediaLink: input.mediaLink,
        caption: input.caption,
        filename: input.filename,
        templateName: input.templateName,
        languageCode: input.languageCode,
        templateComponents: input.templateComponents,
        location: input.location,
        reactToMessageId: input.reactToMessageId,
        emoji: input.emoji,
        internal: input.internal,
      },
    });
    perf.end({ messageId: String(localMessage._id), channel: 'whatsapp', deferred: true });
    return localMessage;
  }

  return dispatchAndFinalize(localMessage, input, conversation, contact, isDemoContact, replyToMetaMessageId, perf);
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
    templateName: input.type === 'template' ? input.templateName : undefined,
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
