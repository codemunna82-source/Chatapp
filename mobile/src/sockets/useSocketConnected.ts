import { useEffect, useState } from 'react';
import { getSocket } from './socketClient';

/**
 * Tracks the socket's connection state, and — crucially — gives callers a
 * value that CHANGES on every reconnect, not just the first connect.
 *
 * Socket.IO rooms are per-connection server-side state: a reconnect gets a
 * new socket id and belongs to no rooms at all. Anything the client told
 * the server once at mount (a room join, a read receipt) is gone and has to
 * be said again. socket.io-client's outgoing buffer does not cover this —
 * it flushes queued packets on the FIRST connect, but a packet already
 * delivered is never re-sent on a later reconnect.
 *
 * `generation` increments on each connect, so an effect keyed on it re-runs
 * per reconnect while an effect keyed only on `connected` would not (it
 * returns to the same `true` it already had).
 */
export function useSocketConnection(): { connected: boolean; generation: number } {
  const [state, setState] = useState(() => ({
    connected: getSocket().connected,
    // Start at 1 when already connected so a consumer mounting mid-session
    // still runs its effect once; 0 means "never connected yet".
    generation: getSocket().connected ? 1 : 0,
  }));

  useEffect(() => {
    const socket = getSocket();
    const onConnect = () => setState((s) => ({ connected: true, generation: s.generation + 1 }));
    const onDisconnect = () => setState((s) => ({ ...s, connected: false }));

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    // The socket may have connected between this component's render and
    // this effect running, in which case the 'connect' event already fired
    // and nothing above would ever tell us.
    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return state;
}
