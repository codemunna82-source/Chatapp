import { conversationRoom } from '../rooms';
import type { GuestContext } from '../../modules/guest/guest.service';
import type { AppSocket } from '../types';

/**
 * "Customer is typing", relayed to whoever has that chat open.
 *
 * The conversation comes from the session, not from the payload — a guest
 * has exactly one, and accepting an id from the client would let a link
 * holder broadcast into someone else's chat. The events the agent app
 * already listens for are reused verbatim, and its handler reads only
 * `conversationId`, so this shows up in the installed build without an
 * app change.
 */
export function registerGuestTypingHandlers(socket: AppSocket, guest: GuestContext): void {
  const room = conversationRoom(guest.conversationId);
  const relay = (event: 'typing:start' | 'typing:stop') => () => {
    socket.to(room).emit(event, { conversationId: guest.conversationId, fromCustomer: true });
  };

  socket.on('typing:start', relay('typing:start'));
  socket.on('typing:stop', relay('typing:stop'));
}
