import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  type MediaStream,
} from 'react-native-webrtc';
import type { IceServer } from '../api/endpoints/calls';
import type { CallSessionState } from './callSession';
import { MicrophoneUnavailableError } from './callSession';

/**
 * A call with the customer's web chat window.
 *
 * Deliberately separate from callSession.ts, which answers WhatsApp calls.
 * That one produces a single fully-gathered answer because Meta's calling
 * API is one REST exchange with nowhere to put late candidates, and it
 * needs only STUN because Meta relays the media so neither side ever has
 * to reach the other.
 *
 * Neither holds here. There is a socket open in both directions, so
 * candidates trickle and the answer goes out immediately instead of after
 * a gathering timeout. And the far end is a browser rather than Meta, so
 * the two really do have to reach each other — which on mobile carrier
 * NAT usually means a TURN relay, supplied by the server.
 */

export interface WebCallSession {
  /** The SDP answer, ready to send the moment it exists — candidates follow separately. */
  readonly answerSdp: string;
  /** A candidate from the far end. Queued if it arrives before the offer is applied. */
  addRemoteCandidate(candidate: RTCIceCandidateInit): void;
  setMuted(muted: boolean): void;
  close(): void;
}

/** The agent's side when they are the one calling. */
export interface WebCallOutgoingSession {
  /** The SDP offer to send with the invite. */
  readonly offerSdp: string;
  /** Applies the customer's answer when it arrives. */
  applyAnswer(sdp: string): Promise<void>;
  addRemoteCandidate(candidate: RTCIceCandidateInit): void;
  setMuted(muted: boolean): void;
  close(): void;
}

export interface AnswerWebCallOptions {
  offerSdp: string;
  iceServers: IceServer[];
  /** Called for each local candidate as it is discovered. */
  onIceCandidate: (candidate: unknown) => void;
  onStateChange?: (state: CallSessionState) => void;
}

export async function answerWebCall(opts: AnswerWebCallOptions): Promise<WebCallSession> {
  let localStream: MediaStream;
  try {
    // Opened before the answer is produced, so a denied permission surfaces
    // as a failure to answer rather than a connected call the customer
    // cannot be heard on.
    localStream = (await mediaDevices.getUserMedia({ audio: true, video: false })) as MediaStream;
  } catch (err) {
    throw new MicrophoneUnavailableError(err);
  }

  const pc = new RTCPeerConnection({ iceServers: opts.iceServers });
  let closed = false;
  const pendingRemote: RTCIceCandidateInit[] = [];

  const teardown = () => {
    if (closed) return;
    closed = true;
    // Tracks first: the microphone is released even if closing the
    // connection throws, so the recording indicator never stays lit.
    for (const track of localStream.getTracks()) track.stop();
    try {
      pc.close();
    } catch {
      // Already closed by the far end.
    }
  };

  // The `on*` setters rather than addEventListener: react-native-webrtc
  // ships its EventTarget shim without type declarations, so
  // addEventListener is invisible to TypeScript even though it exists.
  // Typed at the call site: react-native-webrtc's `on*` setters are
  // declared loosely enough that the event parameter is otherwise implicit
  // any, and a null candidate is the ordinary end-of-gathering signal.
  pc.onicecandidate = (event: { candidate: { toJSON: () => unknown } | null }) => {
    if (event.candidate) opts.onIceCandidate(event.candidate.toJSON());
  };

  pc.onconnectionstatechange = () => {
    switch (pc.connectionState) {
      case 'connected':
        opts.onStateChange?.('connected');
        break;
      case 'failed':
        opts.onStateChange?.('failed');
        break;
      case 'disconnected':
      case 'closed':
        opts.onStateChange?.('ended');
        break;
      default:
        break;
    }
  };

  try {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }

    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: opts.offerSdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Read back from localDescription: `answer` is the object before the
    // local description was applied.
    const answerSdp = pc.localDescription?.sdp;
    if (!answerSdp) {
      throw new Error('WebRTC produced no local description to answer with');
    }

    const addRemoteCandidate = (candidate: RTCIceCandidateInit) => {
      if (closed) return;
      if (!pc.remoteDescription) {
        pendingRemote.push(candidate);
        return;
      }
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {
        // Duplicate or late candidate — routine during trickle.
      });
    };

    // The offer is already applied, so anything queued while the
    // microphone was opening can go in now.
    for (const queued of pendingRemote.splice(0)) addRemoteCandidate(queued);

    return {
      answerSdp,
      addRemoteCandidate,
      setMuted(muted: boolean) {
        for (const track of localStream.getAudioTracks()) {
          track.enabled = !muted;
        }
      },
      close: teardown,
    };
  } catch (err) {
    teardown();
    throw err;
  }
}

/**
 * The agent placing a call into the customer's web chat window.
 *
 * The mirror of answerWebCall: this side makes the offer and waits for the
 * answer, and candidates trickle from the moment the offer goes out —
 * which is while the far end is still ringing, so the customer's early
 * candidates arrive before there is a remote description to hold them.
 * They queue until applyAnswer lands.
 */
export async function placeWebCall(opts: {
  iceServers: IceServer[];
  onIceCandidate: (candidate: unknown) => void;
  onStateChange?: (state: CallSessionState) => void;
}): Promise<WebCallOutgoingSession> {
  let localStream: MediaStream;
  try {
    localStream = (await mediaDevices.getUserMedia({ audio: true, video: false })) as MediaStream;
  } catch (err) {
    throw new MicrophoneUnavailableError(err);
  }

  const pc = new RTCPeerConnection({ iceServers: opts.iceServers });
  let closed = false;
  const pendingRemote: RTCIceCandidateInit[] = [];

  const teardown = () => {
    if (closed) return;
    closed = true;
    for (const track of localStream.getTracks()) track.stop();
    try {
      pc.close();
    } catch {
      // Already closed by the far end.
    }
  };

  pc.onicecandidate = (event: { candidate: { toJSON: () => unknown } | null }) => {
    if (event.candidate) opts.onIceCandidate(event.candidate.toJSON());
  };

  pc.onconnectionstatechange = () => {
    switch (pc.connectionState) {
      case 'connected':
        opts.onStateChange?.('connected');
        break;
      case 'failed':
        opts.onStateChange?.('failed');
        break;
      case 'disconnected':
      case 'closed':
        opts.onStateChange?.('ended');
        break;
      default:
        break;
    }
  };

  try {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }

    const offer = await pc.createOffer({});
    await pc.setLocalDescription(offer);
    const offerSdp = pc.localDescription?.sdp;
    if (!offerSdp) {
      throw new Error('WebRTC produced no local description to offer with');
    }

    const addRemoteCandidate = (candidate: RTCIceCandidateInit) => {
      if (closed) return;
      if (!pc.remoteDescription) {
        pendingRemote.push(candidate);
        return;
      }
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {
        // Duplicate or late candidate — routine during trickle.
      });
    };

    return {
      offerSdp,
      async applyAnswer(sdp: string) {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
        // Everything that arrived while the customer was deciding.
        for (const queued of pendingRemote.splice(0)) addRemoteCandidate(queued);
      },
      addRemoteCandidate,
      setMuted(muted: boolean) {
        for (const track of localStream.getAudioTracks()) {
          track.enabled = !muted;
        }
      },
      close: teardown,
    };
  } catch (err) {
    teardown();
    throw err;
  }
}
