import { useEffect } from 'react';
import { getSocket } from './socketClient';

/**
 * Joins the conversation:{id} room (spec §22) for as long as the caller is
 * mounted — the backend re-verifies the conversation belongs to this
 * user's tenant before granting the join (see backend's
 * events/conversation.ts), so this is never itself a source of authority.
 */
export function useConversationRoom(conversationId: string | undefined): void {
  useEffect(() => {
    if (!conversationId) return;
    const socket = getSocket();
    socket.emit('conversation:join', { conversationId });
    return () => {
      socket.emit('conversation:leave', { conversationId });
    };
  }, [conversationId]);
}
