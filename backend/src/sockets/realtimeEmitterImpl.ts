import { tenantRoom, conversationRoom, userRoom, phoneNumberRoom } from './rooms';
import type { RealtimeEmitter } from '../realtime/events';
import type { AppServer } from './types';

/**
 * The real, Socket.IO-backed RealtimeEmitter — installed via
 * setRealtimeEmitter() once the socket server starts (see socketServer.ts).
 * Everything upstream (webhook ingestion, outbound sends) already went
 * through the no-op version in earlier phases without depending on this
 * file at all.
 */
export function createSocketRealtimeEmitter(io: AppServer): RealtimeEmitter {
  /**
   * The three rooms a chat event goes to:
   *
   * - the conversation room, for whoever has that chat open;
   * - the tenant room, holding only users with full visibility (admins and
   *   the unassigned) so their chat list updates without having joined;
   * - the number room, holding the users scoped to this number.
   *
   * A socket is in at most one of the latter two — joinVisibilityRooms picks
   * exactly one — and Socket.IO de-duplicates across `.to()` anyway, so a
   * client in several of these still receives the event once.
   */
  // null for an SMS-only conversation — no number room to join, so the
  // event reaches only the tenant room (MASTER_ADMIN and unscoped sub-
  // users; see conversation.access.ts's visibleWhatsAppPhoneNumberId),
  // the same audience the REST list already restricts an SMS
  // conversation to.
  const chatRooms = (tenantId: string, conversationId: string, whatsappPhoneNumberId: string | null) => {
    const base = io.to(conversationRoom(conversationId)).to(tenantRoom(tenantId));
    return whatsappPhoneNumberId ? base.to(phoneNumberRoom(whatsappPhoneNumberId)) : base;
  };

  /** Calls go to the same audience as that number's chats — no conversation
   *  room, because a ringing call has no chat open yet. */
  const numberAudience = (tenantId: string, whatsappPhoneNumberId: string) =>
    io.to(tenantRoom(tenantId)).to(phoneNumberRoom(whatsappPhoneNumberId));

  return {
    emitCallIncoming(tenantId, call, whatsappPhoneNumberId) {
      numberAudience(tenantId, whatsappPhoneNumberId).emit('call:incoming', call);
    },
    emitCallEnded(tenantId, call, whatsappPhoneNumberId) {
      numberAudience(tenantId, whatsappPhoneNumberId).emit('call:ended', call);
    },
    emitMessageNew(tenantId, message, whatsappPhoneNumberId) {
      chatRooms(tenantId, message.conversationId, whatsappPhoneNumberId).emit('message:new', message);
    },
    emitMessageUpdated(tenantId, message, whatsappPhoneNumberId) {
      chatRooms(tenantId, message.conversationId, whatsappPhoneNumberId).emit('message:updated', message);
    },
    emitMessageStatus(tenantId, conversationId, messageId, status, whatsappPhoneNumberId) {
      chatRooms(tenantId, conversationId, whatsappPhoneNumberId).emit('message:status', {
        conversationId,
        messageId,
        status,
      });
    },
    emitWebCallEnded(conversationId, payload) {
      io.to(conversationRoom(conversationId)).emit('web:call:ended', payload);
    },
    emitConversationUpdated(tenantId, conversation) {
      const target = io.to(tenantRoom(tenantId));
      (conversation.whatsappPhoneNumberId ? target.to(phoneNumberRoom(conversation.whatsappPhoneNumberId)) : target).emit(
        'conversation:updated',
        conversation,
      );
    },
    emitConversationRead(tenantId, conversationId, byUserId, whatsappPhoneNumberId) {
      const target = io.to(tenantRoom(tenantId));
      (whatsappPhoneNumberId ? target.to(phoneNumberRoom(whatsappPhoneNumberId)) : target).emit('conversation:read', {
        conversationId,
        byUserId,
      });
    },
    emitNotificationNew(_tenantId, userId, notification) {
      // Notifications are per-user, not broadcast tenant-wide.
      io.to(userRoom(userId)).emit('notification:new', notification);
    },
    emitInvitationSent(tenantId, conversationId, whatsappPhoneNumberId) {
      chatRooms(tenantId, conversationId, whatsappPhoneNumberId).emit('invitation:sent', { conversationId });
    },
  };
}
