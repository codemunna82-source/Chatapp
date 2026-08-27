import { tenantRoom, conversationRoom, userRoom } from './rooms';
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
  return {
    emitMessageNew(tenantId, message) {
      // Both rooms: the open-chat viewer (conversation room) and every
      // other device in the tenant that needs its chat-list preview/unread
      // badge updated without having joined that specific conversation.
      io.to(conversationRoom(message.conversationId)).to(tenantRoom(tenantId)).emit('message:new', message);
    },
    emitMessageUpdated(tenantId, message) {
      io.to(conversationRoom(message.conversationId)).to(tenantRoom(tenantId)).emit('message:updated', message);
    },
    emitMessageStatus(tenantId, conversationId, messageId, status) {
      io.to(conversationRoom(conversationId))
        .to(tenantRoom(tenantId))
        .emit('message:status', { conversationId, messageId, status });
    },
    emitConversationUpdated(tenantId, conversation) {
      io.to(tenantRoom(tenantId)).emit('conversation:updated', conversation);
    },
    emitConversationRead(tenantId, conversationId, byUserId) {
      io.to(tenantRoom(tenantId)).emit('conversation:read', { conversationId, byUserId });
    },
    emitNotificationNew(_tenantId, userId, notification) {
      // Notifications are per-user, not broadcast tenant-wide.
      io.to(userRoom(userId)).emit('notification:new', notification);
    },
  };
}
