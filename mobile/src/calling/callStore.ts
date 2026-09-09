import { create } from 'zustand';
import * as callsApi from '../api/endpoints/calls';
import { getApiErrorMessage } from '../api/client';
import { answerIncomingCall, MicrophoneUnavailableError, type CallSession } from './callSession';
import { answerWebCall, placeWebCall, type WebCallSession, type WebCallOutgoingSession } from './webCallSession';
import { getWebCallIceServers } from '../api/endpoints/calls';
import {
  emitWebCallAnswer,
  emitWebCallEnd,
  emitWebCallIce,
  emitWebCallInvite,
  emitWebCallReject,
} from '../sockets/actions';

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

/**
 * The `web:call:incoming` payload — a customer calling from the chat
 * window rather than from WhatsApp.
 *
 * No `fromPhone`: they are identified by the conversation they hold a link
 * to, not by a number that placed the call.
 */
export interface WebIncomingCallPayload {
  callId: string;
  conversationId: string;
  contactId?: string;
  contactName?: string;
  sdp?: string;
}

/** The `call:ended` socket payload. */
export interface CallEndedPayload {
  callId: string;
  status?: string;
  durationSeconds?: number;
}

interface CallState {
  phase: CallPhase;
  /**
   * Which kind of call this is. The two are answered and ended in
   * completely different ways — one through Meta's REST API, one over the
   * socket — so nothing may act on a live call without checking.
   */
  channel: 'meta' | 'web';
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
  ringWeb: (payload: WebIncomingCallPayload) => void;
  /** Calls the customer in their web chat window. */
  placeWebCall: (conversationId: string, contactName: string) => Promise<void>;
  /** The customer picked up — apply their answer. */
  applyWebAnswer: (callId: string, sdp: string) => void;
  /** A trickled candidate from the far end; buffered if the call is not answered yet. */
  addRemoteIce: (callId: string, candidate: RTCIceCandidateInit) => void;
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
let webSession: WebCallSession | null = null;
/** Set instead of webSession when this device is the one calling. */
let outgoingWebSession: WebCallOutgoingSession | null = null;
/**
 * Candidates that arrived before the call was answered.
 *
 * The far end starts trickling the moment it sends the offer, which is
 * while the phone is still ringing — there is no peer connection to give
 * them to yet, and dropping them costs exactly the relay candidates a
 * mobile connection depends on.
 */
let pendingRemoteIce: RTCIceCandidateInit[] = [];

/**
 * Our own candidates, gathered before the server handed back a call id.
 *
 * The same problem in the opposite direction, and the one that actually
 * stopped calls connecting. Gathering starts the instant the offer's local
 * description is set — milliseconds — while the id they must be addressed
 * with only arrives on the invite's acknowledgement, a network round trip
 * later. Every candidate found in between used to be discarded, which on a
 * fast connection is most of them.
 */
let pendingLocalIce: unknown[] = [];

/** Gives up on an outgoing call nobody answers, rather than sitting on "Connecting…". */
let ringTimer: ReturnType<typeof setTimeout> | null = null;
const RING_TIMEOUT_MS = 45_000;

function clearRingTimer() {
  if (ringTimer) clearTimeout(ringTimer);
  ringTimer = null;
}

function closeSession() {
  clearRingTimer();
  pendingLocalIce = [];
  session?.close();
  session = null;
  webSession?.close();
  webSession = null;
  outgoingWebSession?.close();
  outgoingWebSession = null;
  pendingRemoteIce = [];
}

const IDLE = {
  phase: 'idle' as CallPhase,
  channel: 'meta' as const,
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
      channel: 'meta',
      callId: payload.callId,
      contactName: payload.contactName ?? null,
      fromPhone: payload.fromPhone,
      sdpOffer: payload.sdpOffer ?? null,
      muted: false,
      connectedAt: null,
      message: null,
    });
  },

  ringWeb: (payload) => {
    // Same one-at-a-time rule as WhatsApp calls: replacing a live call
    // would drop a conversation already in progress, and a second ring is
    // far more often a reconnect replaying than a real second caller.
    if (get().phase !== 'idle') return;

    pendingRemoteIce = [];
    set({
      phase: 'ringing',
      channel: 'web',
      callId: payload.callId,
      contactName: payload.contactName ?? 'Web chat',
      // There is no number: a web caller is identified by the conversation
      // they hold a link to.
      fromPhone: null,
      sdpOffer: payload.sdp ?? null,
      muted: false,
      connectedAt: null,
      message: null,
    });
  },

  addRemoteIce: (callId, candidate) => {
    if (get().callId !== callId) return;
    if (webSession) {
      webSession.addRemoteCandidate(candidate);
      return;
    }
    if (outgoingWebSession) {
      outgoingWebSession.addRemoteCandidate(candidate);
      return;
    }
    // Still ringing: hold them until there is a connection to put them in.
    pendingRemoteIce.push(candidate);
  },

  placeWebCall: async (conversationId, contactName) => {
    if (get().phase !== 'idle') return;

    // 'connecting' rather than a new phase: the overlay already renders it
    // as "Connecting…" with a hang-up button and no ringer, which is
    // exactly an outgoing call.
    pendingRemoteIce = [];
    set({
      ...IDLE,
      phase: 'connecting',
      channel: 'web',
      contactName,
    });

    try {
      const iceServers = await getWebCallIceServers();
      const outgoing = await placeWebCall({
        iceServers,
        onIceCandidate: (candidate) => {
          const { callId } = get();
          // Queued rather than dropped when the id is not back yet — see
          // pendingLocalIce.
          if (!callId) {
            pendingLocalIce.push(candidate);
            return;
          }
          emitWebCallIce(callId, candidate);
        },
        onStateChange: (state) => {
          if (state === 'connected') {
            clearRingTimer();
          } else if (state === 'failed') {
            closeSession();
            set({ phase: 'failed', message: 'The connection dropped.' });
          } else if (state === 'ended') {
            closeSession();
            set({ phase: 'ended', message: 'Call ended' });
          }
        },
      });

      // Hung up while the microphone and ICE were being set up.
      if (get().phase !== 'connecting') {
        outgoing.close();
        return;
      }
      outgoingWebSession = outgoing;

      emitWebCallInvite(conversationId, outgoing.offerSdp, (res) => {
        if (!res?.success || !res.callId) {
          closeSession();
          set({ phase: 'failed', message: res?.error ?? 'Could not start the call.' });
          return;
        }
        set({ callId: res.callId });
        // Both queues drain here: theirs into the connection, ours onto
        // the wire. Neither had anywhere to go until this id existed.
        for (const queued of pendingRemoteIce.splice(0)) outgoing.addRemoteCandidate(queued);
        for (const queued of pendingLocalIce.splice(0)) emitWebCallIce(res.callId, queued);

        ringTimer = setTimeout(() => {
          if (get().callId !== res.callId) return;
          emitWebCallEnd(res.callId);
          closeSession();
          set({ phase: 'ended', message: 'No answer' });
        }, RING_TIMEOUT_MS);
      });
    } catch (err) {
      closeSession();
      set({
        phase: 'failed',
        message:
          err instanceof MicrophoneUnavailableError
            ? 'VOXO needs microphone access to make calls. Enable it in your phone settings.'
            : getApiErrorMessage(err, 'Could not start the call.'),
      });
    }
  },

  applyWebAnswer: (callId, sdp) => {
    if (get().callId !== callId || !outgoingWebSession) return;
    outgoingWebSession
      .applyAnswer(sdp)
      .then(() => set({ phase: 'active', connectedAt: Date.now() }))
      .catch(() => {
        closeSession();
        set({ phase: 'failed', message: 'Could not connect the call.' });
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

    if (get().channel === 'web') {
      try {
        const iceServers = await getWebCallIceServers();
        const newSession = await answerWebCall({
          offerSdp: sdpOffer,
          iceServers,
          onIceCandidate: (candidate) => emitWebCallIce(callId, candidate),
          onStateChange: (state) => {
            if (state === 'failed') {
              closeSession();
              set({ phase: 'failed', message: 'The connection dropped.' });
            } else if (state === 'ended') {
              closeSession();
              set({ phase: 'ended', message: 'Call ended' });
            }
          },
        });

        // The user may have hung up while the microphone and ICE were
        // being set up; answering now would connect a call they left.
        if (get().phase !== 'connecting') {
          newSession.close();
          return;
        }
        webSession = newSession;
        for (const queued of pendingRemoteIce.splice(0)) newSession.addRemoteCandidate(queued);

        emitWebCallAnswer(callId, newSession.answerSdp);
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
      return;
    }

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
    const { callId, channel } = get();
    closeSession();
    set({ ...IDLE });
    if (!callId) return;
    if (channel === 'web') {
      // Over the socket, not Meta's REST API — these are different calls
      // with different far ends, and there is no Meta call id here.
      emitWebCallReject(callId);
      return;
    }
    try {
      await callsApi.rejectCall(callId);
    } catch {
      // The overlay is already gone and the customer's call will time out
      // on its own. Surfacing this would put an error on screen about a
      // call the user has deliberately walked away from.
    }
  },

  hangUp: async () => {
    const { callId, channel } = get();
    closeSession();
    set({ ...IDLE });
    if (!callId) return;
    if (channel === 'web') {
      emitWebCallEnd(callId);
      return;
    }
    try {
      await callsApi.hangUpCall(callId);
    } catch {
      // Same reasoning as reject: the local side is already down.
    }
  },

  toggleMute: () => {
    const next = !get().muted;
    session?.setMuted(next);
    webSession?.setMuted(next);
    outgoingWebSession?.setMuted(next);
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
