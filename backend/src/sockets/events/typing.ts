import { conversationRoom } from '../rooms';
import type { AppSocket } from '../types';

interface TypingPayload {
  conversationId?: string;
}

/**
 * Ephemeral, never persisted. Relayed only to the conversation room the
 * emitting socket has itself already joined (via `conversation:join`, which
 * verifies tenant ownership) — otherwise a socket could broadcast
 * "typing" into a conversation room it was never authorized to join,
 * leaking presence information across the tenant boundary.
 */
export function registerTypingHandlers(socket: AppSocket): void {
  const { auth } = socket.data;

  socket.on('typing:start', (payload: TypingPayload) => {
    const conversationId = payload?.conversationId;
    if (!conversationId || !socket.rooms.has(conversationRoom(conversationId))) return;
    socket.to(conversationRoom(conversationId)).emit('typing:start', { conversationId, userId: auth.userId });
  });

  socket.on('typing:stop', (payload: TypingPayload) => {
    const conversationId = payload?.conversationId;
    if (!conversationId || !socket.rooms.has(conversationRoom(conversationId))) return;
    socket.to(conversationRoom(conversationId)).emit('typing:stop', { conversationId, userId: auth.userId });
  });
}
