import { logger } from '../../lib/logger';
import { tenantRoom, conversationRoom } from '../rooms';
import { findConversationByIdAndTenant, markConversationRead } from '../../modules/conversations/conversation.repository';
import { toRealtimeConversation } from '../../realtime/serializers';
import type { AppServer, AppSocket } from '../types';

interface JoinLeavePayload {
  conversationId?: string;
}

type Ack = (res: { success: boolean; error?: string }) => void;

/**
 * `conversation:join` / `conversation:leave` are the plumbing that makes the
 * `conversation:{conversationId}` room (spec §22) usable: a client must
 * explicitly ask to join, and joining is only granted after verifying the
 * conversation actually belongs to the socket's own tenant — never trust a
 * conversationId the client sends without checking it server-side, exactly
 * like every REST tenant-scoped lookup in this codebase.
 */
export function registerConversationHandlers(io: AppServer, socket: AppSocket): void {
  const { auth } = socket.data;

  socket.on('conversation:join', async (payload: JoinLeavePayload, ack?: Ack) => {
    const conversationId = payload?.conversationId;
    if (!conversationId) {
      ack?.({ success: false, error: 'conversationId is required' });
      return;
    }
    const conversation = await findConversationByIdAndTenant(conversationId, auth.tenantId);
    if (!conversation) {
      ack?.({ success: false, error: 'Conversation not found' });
      return;
    }
    await socket.join(conversationRoom(conversationId));
    ack?.({ success: true });
  });

  socket.on('conversation:leave', (payload: JoinLeavePayload) => {
    if (payload?.conversationId) {
      socket.leave(conversationRoom(payload.conversationId));
    }
  });

  socket.on('conversation:read', async (payload: JoinLeavePayload, ack?: Ack) => {
    const conversationId = payload?.conversationId;
    if (!conversationId) {
      ack?.({ success: false, error: 'conversationId is required' });
      return;
    }
    const conversation = await markConversationRead(conversationId, auth.tenantId);
    if (!conversation) {
      ack?.({ success: false, error: 'Conversation not found' });
      return;
    }

    io.to(tenantRoom(auth.tenantId)).emit('conversation:read', { conversationId, byUserId: auth.userId });
    io.to(tenantRoom(auth.tenantId)).emit('conversation:updated', toRealtimeConversation(conversation));
    ack?.({ success: true });
  });

  socket.on('error', (err) => {
    logger.warn({ err, socketId: socket.id }, 'Socket error');
  });
}
