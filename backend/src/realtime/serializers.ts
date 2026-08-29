import type { MessageDoc } from '../modules/messages/message.model';
import type { ConversationDoc } from '../modules/conversations/conversation.model';
import type { RealtimeMessagePayload, RealtimeConversationPayload } from './events';

/** Shared shaping so every emit site (webhook ingestion, outbound send, future reactions) sends the same shape. */
export function toRealtimeMessage(doc: MessageDoc): RealtimeMessagePayload {
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
    createdAt: doc.get('createdAt').toISOString(),
  };
}

export function toRealtimeConversation(doc: ConversationDoc): RealtimeConversationPayload {
  return {
    id: String(doc._id),
    contactId: String(doc.contactId),
    whatsappPhoneNumberId: String(doc.whatsappPhoneNumberId),
    lastMessageAt: doc.lastMessageAt?.toISOString(),
    lastMessagePreview: doc.lastMessagePreview ?? undefined,
    unreadCount: doc.unreadCount,
    manuallyUnread: doc.manuallyUnread,
    pinned: doc.pinned,
  };
}
