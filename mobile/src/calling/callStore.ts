import { create } from 'zustand';
import * as callsApi from '../api/endpoints/calls';
import { getApiErrorMessage } from '../api/client';
import { answerIncomingCall, MicrophoneUnavailableError, type CallSession } from './callSession';

/**
 * The one live call this device is handling.
 *
 * A store rather than screen state because a call has to survive whatever
 * the user was doing when it arrived — the overlay is mounted above the
 * navigator (see RootNavigator) and reads from here, so answering a call
 * never depends on which screen happened to be open.
 */

export type CallPhase =
  | 'idle'
  | 'ringing'
  | 'connecting'
  | 'active'
  /** The call is over and the overlay is showing why, briefly, before closing. */
  | 'ended'
  | 'failed';

/** The `call:incoming` socket payload, as the backend emits it. */
export interface IncomingCallPayload {
  callId: string;
  callLogId: string;
  contactId: string;
  contactName?: string;
  fromPhone: string;
  sdpOffer?: string;
}

/** The `call:ended` socket payload. */
export interface CallEndedPayload {
  callId: string;
  status?: string;
  durationSeconds?: number;
}

interface CallState {
  phase: CallPhase;
  callId: string | null;
  contactName: string | null;
  fromPhone: string | null;
  sdpOffer: string | null;
  muted: boolean;
  /** Epoch ms the call connected, for the on-screen duration. */
  connectedAt: number | null;
  /** Why the call failed or how it ended — shown on the overlay. */
  message: string | null;

  ring: (payload: IncomingCallPayload) => void;
  answer: () => Promise<void>;
  reject: () => Promise<void>;
  hangUp: () => Promise<void>;
  toggleMute: () => void;
  remoteEnded: (payload: CallEndedPayload) => void;
  dismiss: () => void;
}

/**
 * The peer connection lives outside the store.
 *
 * It is neither serialisable nor comparable, so putting it in state would
 * make every render of the overlay look like a state change. Nothing but
 * this module touches it, and every path that leaves a call clears it.
 */
let session: CallSession | null = null;

function closeSession() {
  session?.close();
  session = null;
}

const IDLE = {
  phase: 'idle' as CallPhase,
  callId: null,
  contactName: null,
  fromPhone: null,
  sdpOffer: null,
  muted: false,
  connectedAt: null,
  message: null,
};

export const useCallStore = create<CallState>((set, get) => ({
  ...IDLE,

  ring: (payload) => {
    // WhatsApp offers one call at a time, and a second `connect` while one
    // is live is far more likely to be a redelivered webhook than a real
    // second caller. Either way, replacing the live call would drop a
    // conversation already in progress — so the newcomer is ignored.
    if (get().phase !== 'idle') return;

    set({
      phase: 'ringing',
      callId: payload.callId,
      contactName: payload.contactName ?? null,
      fromPhone: payload.fromPhone,
      sdpOffer: payload.sdpOffer ?? null,
      muted: false,
      connectedAt: null,
      message: null,
    });
  },

  answer: async () => {
    const { callId, sdpOffer, phase } = get();
    if (phase !== 'ringing' || !callId) return;

    if (!sdpOffer) {
      // Meta sent a ring with no session offer. There is nothing to answer
      // with, and posting an empty SDP would just fail server-side — say so
      // plainly instead of spinning on "connecting".
      set({ phase: 'failed', message: 'This call arrived without connection details and cannot be answered.' });
      return;
    }

    set({ phase: 'connecting', message: null });

    try {
      const newSession = await answerIncomingCall(sdpOffer);
      // The user may have hung up while the microphone and ICE were being
      // set up. Answering now would connect a call they already left.
      if (get().phase !== 'connecting') {
        newSession.close();
        return;
      }
      session = newSession;

      await callsApi.answerCall(callId, newSession.answerSdp);

      if (get().phase !== 'connecting') {
        closeSession();
        return;
      }

      newSession.onStateChange((state) => {
        if (state === 'failed') {
          closeSession();
          set({ phase: 'failed', message: 'The connection dropped.' });
        } else if (state === 'ended') {
          closeSession();
          set({ phase: 'ended', message: 'Call ended' });
        }
      });

      set({ phase: 'active', connectedAt: Date.now() });
    } catch (err) {
      closeSession();
      set({
        phase: 'failed',
        message:
          err instanceof MicrophoneUnavailableError
            ? 'VOXO needs microphone access to take calls. Enable it in your phone settings.'
            : getApiErrorMessage(err, 'Could not connect the call.'),
      });
    }
  },

  reject: async () => {
    const { callId } = get();
    closeSession();
    set({ ...IDLE });
    if (!callId) return;
    try {
      await callsApi.rejectCall(callId);
    } catch {
      // The overlay is already gone and the customer's call will time out
      // on its own. Surfacing this would put an error on screen about a
      // call the user has deliberately walked away from.
    }
  },

  hangUp: async () => {
    const { callId } = get();
    closeSession();
    set({ ...IDLE });
    if (!callId) return;
    try {
      await callsApi.hangUpCall(callId);
    } catch {
      // Same reasoning as reject: the local side is already down.
    }
  },

  toggleMute: () => {
    const next = !get().muted;
    session?.setMuted(next);
    set({ muted: next });
  },

  remoteEnded: (payload) => {
    // Only the call actually on screen. A terminate for some other call id
    // is a late webhook for one already dealt with.
    if (get().callId !== payload.callId) return;
    closeSession();
    set({
      phase: 'ended',
      message: payload.status === 'REJECTED' ? 'Call declined' : 'Call ended',
      connectedAt: null,
    });
  },

  dismiss: () => {
    closeSession();
    set({ ...IDLE });
  },
}));
