/**
 * Seam for real-time push. A no-op implementation is installed by default
 * so Phase 3's webhook/message pipelines can call this now without
 * depending on Socket.IO internals; Phase 4's socket server installs the
 * real implementation via setRealtimeEmitter() at startup — nothing
 * calling getRealtimeEmitter() needs to change when that happens.
 *
 * Payloads are plain, already-serialized objects (never a Mongoose
 * document) — callers build them from the doc they already have in hand
 * right after a create/update, so the socket layer never needs to
 * re-query the database just to emit an event.
 */
export interface RealtimeMessagePayload {
  id: string;
  conversationId: string;
  direction: 'IN' | 'OUT';
  type: string;
  text?: string;
  mediaId?: string;
  replyToMessageId?: string;
  status: string;
  senderId?: string;
  /** Present only when the message is starred — see Message.starredAt. */
  starredAt?: string;
  createdAt: string;
}

export interface RealtimeConversationPayload {
  id: string;
  contactId: string;
  whatsappPhoneNumberId: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  unreadCount: number;
  pinned: boolean;
}

export interface RealtimeNotificationPayload {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface RealtimeEmitter {
  emitMessageNew(tenantId: string, message: RealtimeMessagePayload): void;
  emitMessageUpdated(tenantId: string, message: RealtimeMessagePayload): void;
  emitMessageStatus(tenantId: string, conversationId: string, messageId: string, status: string): void;
  emitConversationUpdated(tenantId: string, conversation: RealtimeConversationPayload): void;
  emitConversationRead(tenantId: string, conversationId: string, byUserId: string): void;
  emitNotificationNew(tenantId: string, userId: string, notification: RealtimeNotificationPayload): void;
}

const noopEmitter: RealtimeEmitter = {
  emitMessageNew: () => {},
  emitMessageUpdated: () => {},
  emitMessageStatus: () => {},
  emitConversationUpdated: () => {},
  emitConversationRead: () => {},
  emitNotificationNew: () => {},
};

let current: RealtimeEmitter = noopEmitter;

export function getRealtimeEmitter(): RealtimeEmitter {
  return current;
}

/** Called once by the Socket.IO gateway at startup to replace the no-op. */
export function setRealtimeEmitter(emitter: RealtimeEmitter): void {
  current = emitter;
}

/** Test-only: restores the no-op emitter so tests don't leak state into each other. */
export function resetRealtimeEmitter(): void {
  current = noopEmitter;
}
