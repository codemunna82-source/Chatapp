import type { Conversation, Message } from '../api/types';
import type { StoredSms, StoredSmsThread } from '../native/smsStore';

/** SENDING shows the clock, FAILED the red retry; everything else is one tick. */
export function outgoingStatus(status: StoredSms['status']): Message['status'] {
  return status === 'FAILED' ? 'FAILED' : status === 'SENDING' ? 'QUEUED' : 'SENT';
}

/**
 * The key the native store groups a number by (VoxoSmsDatabase.threadKeyFor):
 * the last 10 digits, or all of them when fewer. Null for anything with
 * letters, which never matches a real person's number.
 */
export function phoneThreadKey(phone: string | null | undefined): string | null {
  if (!phone || /[A-Za-z]/.test(phone)) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * One row for one person: the private chat's row, carrying the SMS thread's
 * unread count and — when the SMS is newer — its latest message and time.
 */
export function mergeSmsIntoConversation(conversation: Conversation, thread: StoredSmsThread): Conversation {
  const merged: Conversation = { ...conversation, unreadCount: conversation.unreadCount + thread.unreadCount };
  const conversationAt = conversation.lastMessageAt ? Date.parse(conversation.lastMessageAt) : 0;
  if (thread.timestamp <= conversationAt) return merged;
  return {
    ...merged,
    lastMessageAt: new Date(thread.timestamp).toISOString(),
    lastMessagePreview: thread.body,
    lastMessageDirection: thread.direction,
    lastMessageStatus: thread.direction === 'OUT' ? outgoingStatus(thread.status) : undefined,
  };
}
