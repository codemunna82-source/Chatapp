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
  const chatRooms = (tenantId: string, conversationId: string, whatsappPhoneNumberId: string) =>
    io.to(conversationRoom(conversationId)).to(tenantRoom(tenantId)).to(phoneNumberRoom(whatsappPhoneNumberId));

  return {
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
    emitConversationUpdated(tenantId, conversation) {
      io.to(tenantRoom(tenantId))
        .to(phoneNumberRoom(conversation.whatsappPhoneNumberId))
        .emit('conversation:updated', conversation);
    },
    emitConversationRead(tenantId, conversationId, byUserId, whatsappPhoneNumberId) {
      io.to(tenantRoom(tenantId))
        .to(phoneNumberRoom(whatsappPhoneNumberId))
        .emit('conversation:read', { conversationId, byUserId });
    },
    emitNotificationNew(_tenantId, userId, notification) {
      // Notifications are per-user, not broadcast tenant-wide.
      io.to(userRoom(userId)).emit('notification:new', notification);
    },
  };
}
