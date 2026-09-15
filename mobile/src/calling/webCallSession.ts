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

/**
 * The camera controls a video call adds.
 *
 * Kept on both session shapes rather than on a separate object, because
 * the call overlay holds one session and should not have to ask which
 * kind it is before offering a button — on an audio call these are no-ops
 * and the overlay simply does not draw them.
 */
export interface VideoControls {
  /** The camera off, without leaving the call. Stops sending frames while
   *  keeping the track, so the far end sees a still rather than a
   *  renegotiation. */
  setCameraEnabled(enabled: boolean): void;
  /** Front to back and back again. Does nothing on a device with one. */
  switchCamera(): void;
  /** This side's own picture, for the self-view. Null on an audio call. */
  readonly localStream: MediaStream | null;
}

export interface WebCallSession extends VideoControls {
  /** The SDP answer, ready to send the moment it exists — candidates follow separately. */
  readonly answerSdp: string;
  /** A candidate from the far end. Queued if it arrives before the offer is applied. */
  addRemoteCandidate(candidate: RTCIceCandidateInit): void;
  setMuted(muted: boolean): void;
  close(): void;
}

/** The agent's side when they are the one calling. */
export interface WebCallOutgoingSession extends VideoControls {
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
  /**
   * Open the camera as well as the microphone.
   *
   * Decided by the CALLER and followed here — see the server's
   * CallLog.media. Answering a video call with audio only would leave the
   * caller looking at a black rectangle with no way to tell whether it is
   * broken or deliberate.
   */
  video?: boolean;
  /**
   * The far end's stream, handed over the moment WebRTC produces it.
   *
   * Audio plays itself on both platforms, so this existed for nobody
   * until there was a picture to draw. It fires once per call in
   * practice, but is written to be safe if it fires again.
   */
  onRemoteStream?: (stream: MediaStream) => void;
}

/**
 * What to ask the device for.
 *
 * The camera constraints name a preference, not a requirement: `facingMode`
 * as a plain string is a hint that a device with one camera can ignore,
 * where `exact` would make getUserMedia throw on a phone that has no
 * front camera — failing the whole call over the choice of lens. The
 * frame size is the same bargain: a hint, so a camera that cannot do 720p
 * gives what it has instead of refusing.
 */
function constraintsFor(video?: boolean) {
  if (!video) return { audio: true, video: false } as const;
  return {
    audio: true,
    video: {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    },
  };
}

/**
 * The camera controls, built once over a stream.
 *
 * Shared by both directions because they are identical on each side and
 * the only difference between the two functions below is which end makes
 * the offer.
 *
 * Disabling the track rather than stopping it is deliberate: a stopped
 * track has to be replaced and renegotiated to come back, where a
 * disabled one keeps the transceiver and the far end simply sees the last
 * frame freeze. Turning a camera off and on again should not renegotiate
 * a live call.
 */
function videoControlsFor(stream: MediaStream, hasVideo: boolean): VideoControls {
  return {
    localStream: hasVideo ? stream : null,
    setCameraEnabled(enabled: boolean) {
      for (const track of stream.getVideoTracks()) track.enabled = enabled;
    },
    switchCamera() {
      for (const track of stream.getVideoTracks()) {
        // react-native-webrtc's own extension, not part of the spec. A
        // device with one camera answers by doing nothing.
        (track as unknown as { _switchCamera?: () => void })._switchCamera?.();
      }
    },
  };
}

/**
 * Hands the far end's stream up as soon as WebRTC has one.
 *
 * `ontrack` fires once per track — audio and then video on a video call —
 * and both arrive on the same stream, so this is called more than once
 * with the same object. Callers treat it as idempotent.
 */
function forwardRemoteStream(
  pc: RTCPeerConnection,
  onRemoteStream?: (stream: MediaStream) => void,
): void {
  if (!onRemoteStream) return;
  (pc as unknown as { ontrack: (event: { streams: MediaStream[] }) => void }).ontrack = (event) => {
    const stream = event.streams[0];
    if (stream) onRemoteStream(stream);
  };
}

export async function answerWebCall(opts: AnswerWebCallOptions): Promise<WebCallSession> {
  let localStream: MediaStream;
  try {
    // Opened before the answer is produced, so a denied permission surfaces
    // as a failure to answer rather than a connected call the customer
    // cannot be heard on.
    localStream = (await mediaDevices.getUserMedia(constraintsFor(opts.video))) as MediaStream;
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

  forwardRemoteStream(pc, opts.onRemoteStream);

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
      ...videoControlsFor(localStream, Boolean(opts.video)),
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
  /** Open the camera too. This side decides — see AnswerWebCallOptions. */
  video?: boolean;
  onRemoteStream?: (stream: MediaStream) => void;
}): Promise<WebCallOutgoingSession> {
  let localStream: MediaStream;
  try {
    localStream = (await mediaDevices.getUserMedia(constraintsFor(opts.video))) as MediaStream;
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

  forwardRemoteStream(pc, opts.onRemoteStream);

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
      ...videoControlsFor(localStream, Boolean(opts.video)),
      close: teardown,
    };
  } catch (err) {
    teardown();
    throw err;
  }
}
