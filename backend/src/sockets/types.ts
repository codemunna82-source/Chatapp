import type { Server, Socket, DefaultEventsMap } from 'socket.io';
import type { AuthContext } from '../types/express';

/**
 * Per-socket state attached at handshake by the auth middleware. Client/
 * server event payloads are intentionally left loosely typed (DefaultEventsMap)
 * rather than a full exhaustive event map — the event names and payload
 * shapes are documented at each `.on()`/`.emit()` call site instead.
 */
export interface SocketData {
  auth: AuthContext;
}

export type AppServer = Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;
export type AppSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;
