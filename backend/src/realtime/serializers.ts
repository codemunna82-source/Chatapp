import type { MessageLean } from '../modules/messages/message.model';
import type { ConversationLean } from '../modules/conversations/conversation.model';
import type { RealtimeMessagePayload, RealtimeConversationPayload } from './events';

/** Shared shaping so every emit site (webhook ingestion, outbound send, future reactions) sends the same shape. */
// Takes the lean shape, which a hydrated document also satisfies — so the
// same function serves both the list endpoint (lean rows) and the emit
// sites that have just created or updated a real document.
export function toRealtimeMessage(doc: MessageLean): RealtimeMessagePayload {
  return {
    id: String(doc._id),
    conversationId: String(doc.conversationId),
    direction: doc.direction,
    type: doc.type,
    text: doc.text ?? undefined,
    mediaId: doc.mediaId ? String(doc.mediaId) : undefined,
    replyToMessageId: doc.replyToMessageId ? String(doc.replyToMessageId) : undefined,
    status: doc.status,
    senderId: doc.senderId ? String(doc.senderId) : undefined,
    starredAt: doc.starredAt ? doc.starredAt.toISOString() : undefined,
    sentAt: doc.sentAt ? doc.sentAt.toISOString() : undefined,
    deliveredAt: doc.deliveredAt ? doc.deliveredAt.toISOString() : undefined,
    readAt: doc.readAt ? doc.readAt.toISOString() : undefined,
    createdAt: doc.createdAt.toISOString(),
  };
}

export function toRealtimeConversation(doc: ConversationLean): RealtimeConversationPayload {
  return {
    id: String(doc._id),
    contactId: String(doc.contactId),
    whatsappPhoneNumberId: String(doc.whatsappPhoneNumberId),
    lastMessageAt: doc.lastMessageAt?.toISOString(),
    lastMessagePreview: doc.lastMessagePreview ?? undefined,
    lastMessageDirection: (doc.lastMessageDirection as 'IN' | 'OUT' | null) ?? undefined,
    lastMessageStatus: doc.lastMessageStatus ?? undefined,
    // Defaulted for the same reason as toPublicConversation: this now
    // accepts a lean row, which does not get schema defaults applied.
    unreadCount: doc.unreadCount ?? 0,
    manuallyUnread: doc.manuallyUnread ?? false,
    pinned: doc.pinned ?? false,
  };
}
