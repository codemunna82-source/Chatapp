import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { fetchPendingCall } from '../api/endpoints/calls';
import { useCallStore } from './callStore';

/**
 * Picks up a call that started ringing while the app was closed.
 *
 * The `call:incoming` socket event only reaches a device with the app
 * alive; the push notification reaches one that isn't, but carries no
 * WebRTC offer and nothing replays the socket event afterwards. So when
 * the app comes to the foreground it asks the server directly whether one
 * of its own calls is ringing right now.
 *
 * No UI — mounted once beside RealtimeSync.
 */
export function PendingCallSync(): null {
  // Guards against two checks racing on a fast background/foreground
  // bounce, which would ring, be ignored by the store, and ring again.
  const inFlight = useRef(false);

  useEffect(() => {
    const check = async () => {
      // A call already on screen is the one we would be fetching.
      if (inFlight.current || useCallStore.getState().phase !== 'idle') return;
      inFlight.current = true;
      try {
        const pending = await fetchPendingCall();
        if (pending?.sdpOffer) {
          useCallStore.getState().ring(pending);
        }
      } catch {
        // Offline, or the session is being refreshed. There is nothing to
        // show the user here: they either have a ringing phone in their
        // hand or they don't, and an error toast about a call that may not
        // exist is worse than silence.
      } finally {
        inFlight.current = false;
      }
    };

    // Once on mount — this component mounts as the session starts, which
    // is exactly the cold-launch-from-a-call-push case.
    void check();

    const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') void check();
    });
    return () => sub.remove();
  }, []);

  return null;
}
