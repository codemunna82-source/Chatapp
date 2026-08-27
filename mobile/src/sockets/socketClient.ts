import { io, Socket } from 'socket.io-client';
import { socketUrl } from '../utils/env';
import { useAuthStore } from '../store/authStore';

/**
 * A single shared socket for the whole app (spec §22) — screens subscribe
 * to events via useSocketEvent() (see useSocketEvent.ts) rather than each
 * opening their own connection. Auth uses a callback form so every
 * (re)connect attempt sends whatever the current access token is,
 * including after a silent refresh — no manual "update the socket's auth"
 * step needed when authStore's token changes.
 */
let socket: Socket | null = null;

function createSocket(): Socket {
  return io(socketUrl, {
    autoConnect: false,
    transports: ['websocket'],
    auth: (cb) => cb({ token: useAuthStore.getState().accessToken }),
  });
}

export function getSocket(): Socket {
  if (!socket) {
    socket = createSocket();
  }
  return socket;
}

// Connects/disconnects automatically as the session changes — nothing
// elsewhere in the app needs to remember to call this. A disabled account
// or expired subscription mid-session gets the socket disconnected
// server-side (backend's periodic re-validation); this listener only
// covers the client-initiated sign-in/sign-out transitions.
useAuthStore.subscribe((state, prevState) => {
  if (state.status === prevState.status) return;
  if (state.status === 'signedIn') {
    getSocket().connect();
  } else if (state.status === 'signedOut') {
    getSocket().disconnect();
  }
});
