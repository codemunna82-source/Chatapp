import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { fetchPendingCall } from '../api/endpoints/calls';
import { useCallStore } from './callStore';
import { takePendingAccept } from './callActions';
import { cancelIncomingCall } from './callNotification';

/**
 * Picks up a call that started ringing while the app was closed.
 *
 * The `call:incoming` and `web:call:incoming` socket events only reach a
 * device with the app alive; the push notification reaches one that isn't,
 * but carries no WebRTC offer and nothing replays the socket event
 * afterwards. So when the app comes to the foreground it asks the server
 * directly whether one of its own calls is ringing right now — either
 * kind.
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

        /**
         * Accept was pressed on the notification while the app was closed.
         *
         * The press could not answer anything at the time — there was no
         * session, no socket and no offer, because the push carries none
         * of them. It recorded the intent and launched the app; this is
         * where that intent is honoured.
         *
         * Read before the early return below, so a stale accept is always
         * consumed rather than left to fire at the next call.
         */
        const accepted = takePendingAccept();

        if (!pending?.sdpOffer) {
          // The call ended while the app was starting. Take the ring back
          // rather than leaving a notification for something that is over.
          if (accepted) void cancelIncomingCall(accepted);
          return;
        }
        // Answered down completely different paths, so the store has to be
        // told which this is rather than inferring it from the ids.
        if (pending.channel === 'web') {
          useCallStore.getState().ringWeb({
            callId: pending.callId,
            conversationId: '',
            contactId: pending.contactId,
            contactName: pending.contactName,
            sdp: pending.sdpOffer,
          });
        } else {
          useCallStore.getState().ring(pending);
        }

        // Only when the accept was for THIS call: a stale one must not
        // pick up a different customer, which is the whole reason it
        // carries an id rather than a flag.
        if (accepted && accepted === pending.callId) {
          void cancelIncomingCall(accepted);
          void useCallStore.getState().answer();
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
