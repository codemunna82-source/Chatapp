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
  /** Delivery milestones, each present only once it has happened. readAt
   *  stays absent forever if the customer has read receipts off. */
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  /**
   * Where a `type: 'location'` message points.
   *
   * It was missing here, so the app received the coordinates only as the
   * one-line `text` the server builds for previews — and rendered that
   * literally: "Location (22.594133, 88.393396)" in a text bubble, where
   * every other client draws a map card. The data was in the database the
   * whole time; this is the hop it never made.
   */
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  createdAt: string;
}

export interface RealtimeConversationPayload {
  id: string;
  contactId: string;
  whatsappPhoneNumberId: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  lastMessageDirection?: 'IN' | 'OUT';
  lastMessageStatus?: string;
  unreadCount: number;
  manuallyUnread: boolean;
  pinned: boolean;
}

export interface RealtimeNotificationPayload {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * `whatsappPhoneNumberId` on the chat events is what keeps a workspace's
 * users from seeing each other's chats in real time.
 *
 * Filtering the REST endpoints alone would not be enough: these events are
 * pushed, so without the number to address them by, every message would
 * still arrive on every device in the tenant — the isolation would hold on
 * refresh and leak while the app was open. It is a required parameter, not
 * an optional one, so a new emit site cannot quietly broadcast tenant-wide.
 */
/** A voice call arriving on, or leaving, one of the workspace's numbers. */
export interface RealtimeCallPayload {
  callId: string;
  callLogId: string;
  contactId: string;
  contactName?: string;
  fromPhone: string;
  /**
   * Meta's WebRTC offer, forwarded verbatim to the device that will answer
   * it. The server never terminates the media itself — it only carries
   * this string from Meta to the phone, and the phone's answer back.
   */
  sdpOffer?: string;
  status?: string;
  durationSeconds?: number;
}

export interface RealtimeEmitter {
  emitCallIncoming(tenantId: string, call: RealtimeCallPayload, whatsappPhoneNumberId: string): void;
  emitCallEnded(tenantId: string, call: RealtimeCallPayload, whatsappPhoneNumberId: string): void;
  emitMessageNew(tenantId: string, message: RealtimeMessagePayload, whatsappPhoneNumberId: string): void;
  emitMessageUpdated(tenantId: string, message: RealtimeMessagePayload, whatsappPhoneNumberId: string): void;
  emitMessageStatus(
    tenantId: string,
    conversationId: string,
    messageId: string,
    status: string,
    whatsappPhoneNumberId: string,
  ): void;
  /**
   * A web call ending, to the customer's own window.
   *
   * Its own method because the audience is different from every other
   * call event here: those go to the workspace's agents by number, and
   * this one goes to the single conversation the customer holds a link
   * to. Added so the REST reject can reach them — the socket handler
   * that used to be the only way in is unavailable to a phone acting on
   * a notification with the app closed.
   */
  emitWebCallEnded(
    conversationId: string,
    payload: { callId: string; status: string; durationSeconds: number },
  ): void;
  emitConversationUpdated(tenantId: string, conversation: RealtimeConversationPayload): void;
  emitConversationRead(tenantId: string, conversationId: string, byUserId: string, whatsappPhoneNumberId: string): void;
  emitNotificationNew(tenantId: string, userId: string, notification: RealtimeNotificationPayload): void;
}

const noopEmitter: RealtimeEmitter = {
  emitCallIncoming: () => {},
  emitCallEnded: () => {},
  emitMessageNew: () => {},
  emitMessageUpdated: () => {},
  emitMessageStatus: () => {},
  emitWebCallEnded: () => {},
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
