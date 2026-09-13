import { AppState } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { socketUrl } from '../utils/env';
import { useAuthStore } from '../store/authStore';
import { refreshAccessToken } from '../api/client';

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
    // WebSocket first, but not WebSocket only — and this is what fixed a
    // permanent "Reconnecting" banner. Plenty of mobile networks, captive
    // portals and corporate proxies pass ordinary HTTP and quietly refuse
    // the WebSocket upgrade. With a single transport there is nothing to
    // fall back to, so the socket retried forever, the banner never left,
    // and REST polling carried the messages — the app looked permanently
    // broken while working.
    //
    // tryAllTransports is what actually makes the list a list: without it
    // socket.io gives up after the first entry fails instead of trying
    // the next one.
    transports: ['websocket', 'polling'],
    tryAllTransports: true,
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

/**
 * Handshake failures that no amount of retrying will fix, because the
 * session itself is over. The REST client already ends the session on
 * these; the socket has to agree rather than sit in a retry loop behind
 * a "Reconnecting" banner that will never clear.
 */
const TERMINAL_AUTH_CODES = new Set([
  'SESSION_REPLACED',
  'ACCOUNT_DISABLED',
  'SUBSCRIPTION_EXPIRED',
  'NUMBER_ACCESS_DENIED',
]);

/** Handshake failures that a fresh access token would fix. */
const STALE_TOKEN_CODES = new Set(['AUTH_REQUIRED', 'INVALID_TOKEN']);

/**
 * At most one token refresh per handshake failure burst.
 *
 * socket.io retries every half second at first, and every one of those
 * attempts fails the same way while the token is stale. Refreshing per
 * attempt would be a request storm, and a failed refresh signs the user
 * out — so a flaky network must not be able to trigger it repeatedly.
 */
const REFRESH_COOLDOWN_MS = 20_000;
let lastRefreshAt = 0;

function handleHandshakeFailure(message: string): void {
  if (TERMINAL_AUTH_CODES.has(message)) {
    void useAuthStore.getState().clearSession(message);
    return;
  }
  if (!STALE_TOKEN_CODES.has(message)) return;
  if (useAuthStore.getState().status !== 'signedIn') return;

  const now = Date.now();
  if (now - lastRefreshAt < REFRESH_COOLDOWN_MS) return;
  lastRefreshAt = now;

  // The socket's auth callback reads the current token on every attempt,
  // so there is nothing to tell it: refreshing is enough, and its next
  // retry carries the new one. This is the case that stranded people
  // behind a permanent banner — the token went stale, every retry was
  // rejected with the same stale token, and the only escape was doing
  // something else in the app that happened to refresh it.
  void refreshAccessToken();
}

export function getSocket(): Socket {
  if (!socket) {
    socket = createSocket();
    // Nothing else surfaces a handshake failure. A rejected token or a
    // blocked transport looked exactly like a slow network from the
    // outside: the banner said "Reconnecting" and no reason for it
    // existed anywhere. In dev this is the first thing worth seeing.
    socket.on('connect_error', (err) => {
      if (__DEV__) console.warn('[socket] connect_error', err.message);
      handleHandshakeFailure(err.message);
    });

    socket.on('disconnect', (reason) => {
      if (__DEV__) console.warn('[socket] disconnect', reason);
      // socket.io reconnects itself after a transport drop, but NOT when
      // the server disconnected us deliberately or the client asked to
      // close. `active` is how it says which, and when it is false the
      // socket is DORMANT: not connected, not trying, and nothing in it
      // will ever change that. The banner then says "Reconnecting" about
      // a socket that is doing no such thing, forever.
      if (!socket?.active) syncSocketConnection();
    });
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

/**
 * The last resort, and the reason it exists: a socket that is neither
 * connected nor trying has no way back on its own.
 *
 * Everything above reacts to something — a disconnect event, a store
 * change, the app coming to the foreground. A user sitting in a chat
 * watching the banner is none of those: the app is already foregrounded,
 * nothing is signing in, and if the dormant state was reached by a path
 * not anticipated here, nothing fires at all. That is exactly the report
 * this is for — the banner staying until the screen was left and
 * re-entered, which only worked because it happened to provoke a request
 * that refreshed the token.
 *
 * Cheap by construction: syncSocketConnection does nothing at all when
 * the socket is connected or already retrying, which is almost always.
 */
const WATCHDOG_INTERVAL_MS = 5_000;
setInterval(syncSocketConnection, WATCHDOG_INTERVAL_MS);

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
