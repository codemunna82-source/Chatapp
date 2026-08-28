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
    // Explicit reconnection policy rather than socket.io's defaults, which
    // assume a desktop browser. A phone drops the socket constantly moving
    // between cell and wifi or waking from doze, so: retry indefinitely
    // (never strand the user on a dead socket), start fast so a brief
    // blip recovers almost invisibly, back off to 5s so a long outage
    // doesn't sit in a tight retry loop draining the battery, and jitter
    // so a fleet of clients doesn't stampede the server when it restarts.
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.5,
    // Fail an attempt reasonably quickly on a flaky link instead of
    // hanging until the OS gives up.
    timeout: 10000,
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
