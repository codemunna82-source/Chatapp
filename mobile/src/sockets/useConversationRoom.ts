import { useEffect } from 'react';
import { getSocket } from './socketClient';
import { useSocketConnection } from './useSocketConnected';

/**
 * Joins the conversation:{id} room (spec §22) for as long as the caller is
 * mounted — the backend re-verifies the conversation belongs to this
 * user's tenant before granting the join (see backend's
 * events/conversation.ts), so this is never itself a source of authority.
 *
 * Re-joins on every reconnect, not just on mount. Room membership lives on
 * the server against one socket connection; a phone drops its socket
 * constantly (wifi to cell, waking from doze) and comes back with a new id
 * belonging to no rooms. Joining only at mount meant the open chat silently
 * stopped receiving message:new after the first blip and stayed dead until
 * the user backed out and re-entered it.
 */
export function useConversationRoom(conversationId: string | undefined): void {
  const { connected, generation } = useSocketConnection();

  useEffect(() => {
    if (!conversationId || !connected) return;
    const socket = getSocket();
    socket.emit('conversation:join', { conversationId });
    return () => {
      // Only meaningful while the socket is still up; after a drop the
      // server has already discarded the membership with the connection.
      if (socket.connected) {
        socket.emit('conversation:leave', { conversationId });
      }
    };
  }, [conversationId, connected, generation]);
}
