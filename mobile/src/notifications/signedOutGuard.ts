import { useAuthStore } from '../store/authStore';
import { unregisterForPushNotifications } from './pushRegistration';

/**
 * The last line against a notification for a workspace nobody on this
 * phone is signed into.
 *
 * Every sign-out now detaches the device (see authStore.clearSession),
 * but there is one case that cannot: a session that ended because the
 * REFRESH token expired has no valid credential left to make the request
 * with. The server keeps that token until a send bounces, and until then
 * this install would keep drawing someone else's calls and messages.
 *
 * So the drawing side checks too. A push that arrives with no session is
 * dropped, and the detach is attempted again from here — which is also
 * the moment it is most likely to work, because something has just woken
 * the process.
 *
 * Deliberately not a security boundary: the payload is already on the
 * device by the time this runs, and what stops a signed-out phone
 * receiving a workspace's CONTENT is the server not sending it. This is
 * what stops it being SHOWN, and what gets the token cleaned up.
 */

/** Attempted at most once per process: a burst of pushes to a signed-out
 *  install should not be a burst of identical requests. */
let detachAttempted = false;

export async function hasSignedInSession(): Promise<boolean> {
  // The background task runs with a fresh module graph and nothing has
  // loaded the session yet, so an unhydrated store is not the same thing
  // as a signed-out one.
  if (useAuthStore.getState().accessToken) return true;
  await useAuthStore.getState().hydrate();
  return Boolean(useAuthStore.getState().accessToken);
}

/**
 * True when this push should be drawn.
 *
 * Returns false for a signed-out install, and starts the detach that
 * should have happened when the session ended.
 */
export async function shouldShowPush(): Promise<boolean> {
  if (await hasSignedInSession()) return true;

  if (!detachAttempted) {
    detachAttempted = true;
    // Not awaited into the caller's decision: the answer is already no,
    // and a slow request must not hold a background task open.
    void unregisterForPushNotifications().catch(() => {
      // Offline, or a credential the server will not accept any more —
      // which is the very case this exists for. The next wake tries
      // again.
    });
  }
  return false;
}
