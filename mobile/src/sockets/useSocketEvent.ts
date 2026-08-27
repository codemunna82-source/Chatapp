import { useEffect } from 'react';
import { getSocket } from './socketClient';

/**
 * Subscribes to one Socket.IO event for the lifetime of the calling
 * component. The handler ref is captured fresh on every render via the
 * dependency array the caller passes, matching useEffect's own rules —
 * pass an empty array only if the handler doesn't close over changing state.
 */
export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void, deps: unknown[]): void {
  useEffect(() => {
    const socket = getSocket();
    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
