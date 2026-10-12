import { findOrCreateContactByPhone } from '../contacts/contact.repository';
import { findOrCreateSmsConversation, recordOutboundActivity, recordGuestInboundActivity } from '../conversations/conversation.repository';
import { createMessage, findMessageByClientId } from '../messages/message.repository';
import { getRealtimeEmitter } from '../../realtime/events';
import { toRealtimeMessage, toRealtimeConversation } from '../../realtime/serializers';

/**
 * Resolves (or, usually, just confirms) the SMS conversation for a phone
 * number — what SmsThreadScreen on the mobile side calls when the native
 * lead-SMS notification is tapped (see SmsAutoReplyReceiver.kt's own
 * voxo://sms-thread/<phone> deep link), so tapping it lands on the real
 * conversation window rather than carrying its own separate screen.
 *
 * find-or-create rather than find-only: the periodic sync
 * (SmsSyncRunner.tsx) usually gets there first, but tapping the
 * notification seconds after it fired should not depend on winning that
 * race — the conversation this hands back is exactly the one the next
 * sync pass would have produced anyway.
 */
export async function resolveSmsConversationId(tenantId: string, phone: string): Promise<string> {
  const contact = await findOrCreateContactByPhone(tenantId, phone);
  const conversation = await findOrCreateSmsConversation(tenantId, String(contact._id));
  return String(conversation._id);
}

export interface SmsSyncItem {
  phone: string;
  body: string;
  date: number;
  direction: 'IN' | 'OUT';
  clientMessageId: string;
}

/**
 * One SMS turned into a real, persisted Conversation + Message, shared
 * by both the batch background sync below and sendSmsNow — this is
 * what makes an SMS lead show up in the SAME chat list and window as a
 * WhatsApp conversation, not a separate local-only screen, and what
 * lets a second signed-in device (or VOXO reopened after being killed)
 * see a conversation the phone synced earlier.
 *
 * Returns null on a dedup no-op (an existing message already holds this
 * clientMessageId) rather than that message itself: every caller here
 * either doesn't need it back (the batch sync only counts) or already
 * has its own already-sent copy in hand (sendSmsNow) and would rather
 * know nothing new was created than be handed a stale read of a row
 * someone else's call is also writing to right now.
 */
async function persistOneSms(tenantId: string, userId: string, item: SmsSyncItem) {
  const realtime = getRealtimeEmitter();

  const contact = await findOrCreateContactByPhone(tenantId, item.phone);
  const conversation = await findOrCreateSmsConversation(tenantId, String(contact._id));
  const at = new Date(item.date);

  const message = await createMessage({
    tenantId,
    conversationId: String(conversation._id),
    recipientPhone: contact.phone,
    direction: item.direction,
    channel: 'sms',
    type: 'text',
    text: item.body,
    status: item.direction === 'OUT' ? 'SENT' : 'DELIVERED',
    clientMessageId: item.clientMessageId,
    senderId: item.direction === 'OUT' ? userId : undefined,
    // Backdated to when the text actually went out or arrived, not to
    // whenever this call happened to reach the server — see
    // CreateMessageInput.createdAt.
    createdAt: at,
  });

  // recordGuestInboundActivity reused rather than duplicated: an SMS
  // reaching the device does not reopen WhatsApp's 24-hour customer-
  // service window any more than a web-chat message does, which is
  // exactly the distinction that function already draws from
  // recordInboundActivity — just bump the chat-list preview and the
  // unread count, leave Meta's window fields untouched.
  const updatedConversation =
    item.direction === 'IN'
      ? await recordGuestInboundActivity(String(conversation._id), tenantId, item.body, at)
      : await recordOutboundActivity(String(conversation._id), tenantId, item.body, at, 'SENT', String(message._id));

  // whatsappPhoneNumberId is null here on purpose — see
  // Conversation.whatsappPhoneNumberId and the RealtimeEmitter doc
  // comment on why that is a real, typed "no number room" rather than
  // an omitted argument.
  realtime.emitMessageNew(tenantId, toRealtimeMessage(message), null);
  if (updatedConversation) {
    realtime.emitConversationUpdated(tenantId, toRealtimeConversation(updatedConversation));
  }

  return message;
}

/**
 * Turns a batch of SMS the agent's own phone has read off its inbox/sent
 * boxes (smsSync.ts) into real, persisted Conversation and Message
 * records.
 *
 * There is no webhook for SMS the way there is for WhatsApp — nothing
 * calls this but the one phone whose SIM the text actually went through,
 * polling and POSTing what it finds. tenantId/userId come from the
 * caller's own auth (requireAuth), never from the request body: an SMS
 * carries no tenant of its own, so whichever VOXO user's phone received
 * it is what attributes it to a tenant at all.
 */
export async function syncSmsMessages(tenantId: string, userId: string, items: SmsSyncItem[]): Promise<{ created: number }> {
  let created = 0;

  // Oldest first, so each conversation's denormalized lastMessage* fields
  // end up reflecting whichever of these is genuinely most recent rather
  // than whichever this loop happened to process last.
  const ordered = [...items].sort((a, b) => a.date - b.date);

  for (const item of ordered) {
    // The retry/re-poll case, not a double-send: the same text can show
    // up in more than one sync call (the device re-scans its whole inbox
    // each time), and clientMessageId — the device's own stable SMS row
    // id — is what the unique index on (tenantId, clientMessageId) turns
    // into a no-op instead of a duplicate bubble.
    const existing = await findMessageByClientId(tenantId, item.clientMessageId);
    if (existing) continue;

    await persistOneSms(tenantId, userId, item);
    created += 1;
  }

  return { created };
}

/**
 * Records one SMS the agent just sent live, off the composer in
 * ConversationDetailScreen — see useSendSmsMessage. Unlike
 * syncSmsMessages' batch, the caller here is waiting on the real
 * message back to swap in for its optimistic bubble immediately,
 * rather than for the next background sync pass or realtime push to
 * do it.
 *
 * Dedup still applies: this exact (tenantId, clientMessageId) may
 * already exist if the background sync's own periodic re-scan of
 * content://sms/sent won the race (both sides resolve to the SAME
 * clientMessageId for one real text — see findSentSmsClientMessageId
 * on the mobile side) — in which case the existing message is returned
 * rather than attempted again.
 */
export async function sendSmsNow(tenantId: string, userId: string, item: SmsSyncItem) {
  const existing = await findMessageByClientId(tenantId, item.clientMessageId);
  if (existing) return existing;
  return persistOneSms(tenantId, userId, item);
}
