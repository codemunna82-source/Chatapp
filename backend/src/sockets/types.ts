import type { Server, Socket, DefaultEventsMap } from 'socket.io';
import type { AuthContext } from '../types/express';
import type { GuestContext } from '../modules/guest/guest.service';

/**
 * Per-socket state attached at handshake by the auth middleware. Client/
 * server event payloads are intentionally left loosely typed (DefaultEventsMap)
 * rather than a full exhaustive event map — the event names and payload
 * shapes are documented at each `.on()`/`.emit()` call site instead.
 */
export interface SocketData {
  /** An agent's socket — a logged-in user of the workspace. */
  auth?: AuthContext;
  /**
   * A customer's socket — someone holding a web-chat link. Exactly one of
   * these two is ever set; the connection handler branches on which, and a
   * guest socket never reaches the code that reads `auth`.
   */
  guest?: GuestContext;
}

export type AppServer = Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;
export type AppSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;
