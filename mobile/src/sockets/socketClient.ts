import { AppState } from 'react-native';
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

/**
 * Brings the socket in line with whether there is a session, from whatever
 * just happened.
 *
 * Written as "make it match" rather than "react to the change" on purpose.
 * The old version only acted on a status TRANSITION, which left a real hole:
 * on a cold start the store hydrates a saved session, and if that hydration
 * finished before this module was first imported, the transition had already
 * happened and nothing ever called connect(). The app then sat on a socket
 * that was not connecting and not retrying — socket.io does not reconnect a
 * connection that was never opened — showing "Reconnecting" indefinitely
 * while REST polling quietly carried the messages.
 *
 * Idempotent, so calling it on every store change, at import, and on every
 * foreground costs nothing when things are already right.
 */
export function syncSocketConnection(): void {
  const { status } = useAuthStore.getState();
  const s = getSocket();
  if (status === 'signedIn') {
    // `active` covers "connected or trying to"; connect() on an already
    // connecting socket is a no-op, but checking keeps the intent legible.
    if (!s.connected && !s.active) s.connect();
  } else if (status === 'signedOut') {
    if (s.connected || s.active) s.disconnect();
  }
}

// Every change, not only a status change: a token refresh writes new
// credentials without touching status, and the socket's auth callback reads
// the current token on its next attempt.
useAuthStore.subscribe(() => syncSocketConnection());

// And once now, for the session that was already hydrated before this
// module was imported — the case the transition-only listener missed.
syncSocketConnection();

/**
 * Android kills or silently wedges sockets while the app is backgrounded,
 * and doze can leave socket.io believing it is still connected long after
 * the TCP connection is gone. Reconnecting on foreground is what makes the
 * app work again after switching away and back — which users discovered on
 * their own, by leaving the chat and coming back until it started working.
 */
AppState.addEventListener('change', (next) => {
  if (next !== 'active') return;
  const s = getSocket();
  if (useAuthStore.getState().status !== 'signedIn') return;
  if (s.connected) {
    // Connected by socket.io's reckoning, but that can be a corpse after a
    // doze. One cheap round trip settles it; a dead link fails the ping and
    // socket.io tears down and reconnects on its own.
    s.emit('ping:check');
    return;
  }
  if (!s.active) s.connect();
});
