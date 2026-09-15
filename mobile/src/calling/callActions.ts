import { getJSON, setJSON, remove } from '../storage/mmkv';
import { useAuthStore } from '../store/authStore';
import * as callsApi from '../api/endpoints/calls';
import { useCallStore } from './callStore';
import { cancelIncomingCall, CALL_ACCEPT_ACTION, CALL_REJECT_ACTION } from './callNotification';

/**
 * What happens when Accept or Reject is pressed on the notification.
 *
 * One function for all three worlds the press can arrive in — app in
 * front, app in the background, app not running at all — because the
 * decision is the same in each and only the machinery around it differs.
 * Three copies of this would be three places for the call state to drift.
 */

const PENDING_ACCEPT_KEY = 'voxo.pendingCallAccept';

/**
 * An Accept that has to survive the app starting up.
 *
 * Pressing Accept on a notification with the app closed cannot answer
 * anything: there is no WebRTC session, no socket, and no offer — the
 * push carries none of that, deliberately. So the press is recorded, the
 * notification launches the app, and PendingCallSync — which already asks
 * the server for a ringing call on every foreground — finds this and
 * answers instead of merely ringing.
 *
 * Kept with a timestamp so a stale one cannot answer tomorrow's call: a
 * phone that was accepted from and then never opened would otherwise pick
 * up the next call by itself.
 */
const PENDING_ACCEPT_TTL_MS = 60_000;

interface PendingAccept {
  callId: string;
  at: number;
}

export function rememberPendingAccept(callId: string): void {
  setJSON<PendingAccept>(PENDING_ACCEPT_KEY, { callId, at: Date.now() });
}

/** Reads and CLEARS it — an accept is consumed once, whatever comes of it.
 *  Leaving it would answer the same call again on the next foreground. */
export function takePendingAccept(): string | null {
  const pending = getJSON<PendingAccept>(PENDING_ACCEPT_KEY);
  remove(PENDING_ACCEPT_KEY);
  if (!pending) return null;
  if (Date.now() - pending.at > PENDING_ACCEPT_TTL_MS) return null;
  return pending.callId;
}

/**
 * Handles one press.
 *
 * The notification goes first, before any network: a button that stays on
 * screen while a request is in flight gets pressed again, and the second
 * press is the one that causes trouble.
 */
export async function handleCallAction(actionId: string, callId: string): Promise<void> {
  if (!callId) return;
  await cancelIncomingCall(callId);

  if (actionId === CALL_REJECT_ACTION) {
    // In front of the user, with the call already on screen: let the store
    // do it. It tears down the session, stops the ringer, and picks the
    // right signalling path for the channel — none of which a REST reject
    // alone would do.
    const live = useCallStore.getState();
    if (live.callId === callId && live.phase !== 'idle') {
      await live.reject();
      return;
    }

    // Otherwise this is a headless press: no store, no socket, no session.
    // The REST endpoint handles both call channels for exactly this case.
    try {
      await ensureAuth();
      await callsApi.rejectCall(callId);
    } catch {
      // Offline, or the call has already ended. Either way the ring is
      // gone from this phone and the caller's side times out on its own —
      // there is no screen here to report an error to.
    }
    return;
  }

  if (actionId === CALL_ACCEPT_ACTION) {
    const live = useCallStore.getState();
    if (live.callId === callId && live.phase === 'ringing') {
      await live.answer();
      return;
    }
    // The app is starting because of this press. Recorded for the moment
    // it is ready — see rememberPendingAccept.
    rememberPendingAccept(callId);
  }
}

/** The background handler runs with a fresh module graph and nothing has
 *  loaded the session yet, so the API client would send no token at all. */
async function ensureAuth(): Promise<void> {
  if (useAuthStore.getState().accessToken) return;
  await useAuthStore.getState().hydrate();
}
