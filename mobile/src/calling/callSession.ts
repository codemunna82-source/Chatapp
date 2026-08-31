import {
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
  type MediaStream,
} from 'react-native-webrtc';

/**
 * The WebRTC half of answering a WhatsApp Business call.
 *
 * Meta sends an SDP *offer* over the webhook; this module turns it into an
 * *answer* and holds the peer connection for the life of the call. The
 * backend never touches the audio — it only carries these two strings — so
 * everything below runs on the agent's phone.
 */

/**
 * Meta's own offer already carries their relay candidates, so a STUN
 * server is only needed for this side's reflexive candidate. Google's
 * public one is used rather than a TURN server because the media is
 * relayed by Meta's infrastructure anyway: there is no case where this
 * device has to reach the customer directly.
 */
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * How long to wait for ICE gathering before sending the answer anyway.
 *
 * Meta's calling API is a single-shot REST exchange — there is no channel
 * to trickle late candidates down, so the answer has to carry them all.
 * But `iceGatheringState` reaching `complete` depends on every STUN query
 * finishing or timing out, and on a bad mobile link that can hang well
 * past the point the caller gives up. The candidates gathered in the first
 * couple of seconds are almost always enough to connect, so this bounds
 * the wait rather than risking a ring that never gets answered.
 */
const ICE_GATHERING_TIMEOUT_MS = 2500;

export type CallSessionState = 'connecting' | 'connected' | 'ended' | 'failed';

export interface CallSession {
  /** The SDP answer to hand to POST /calls/:callId/answer. */
  readonly answerSdp: string;
  /** Silences the microphone locally. The call stays connected. */
  setMuted(muted: boolean): void;
  /** Tears down the peer connection and releases the microphone. */
  close(): void;
  /** Fires on every transition after the answer is produced. */
  onStateChange(listener: (state: CallSessionState) => void): void;
}

/** Thrown when the microphone is unavailable — almost always a denied permission. */
export class MicrophoneUnavailableError extends Error {
  constructor(cause: unknown) {
    super('VOXO needs microphone access to take calls.');
    this.name = 'MicrophoneUnavailableError';
    this.cause = cause;
  }
}

/**
 * Resolves once ICE gathering finishes, or once the timeout above expires.
 *
 * Resolving on timeout rather than rejecting is deliberate: a partially
 * gathered answer usually connects, and an answer that is never sent
 * never does.
 */
function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.onicegatheringstatechange = null;
      resolve();
    };
    const timer = setTimeout(finish, ICE_GATHERING_TIMEOUT_MS);
    // The `on*` setters rather than addEventListener: react-native-webrtc
    // 124.0.8 ships its EventTarget shim without type declarations, so
    // addEventListener is invisible to TypeScript even though it exists at
    // runtime. These are declared, and one handler slot per event is all
    // this needs.
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
  });
}

/**
 * Builds the answer for one inbound call.
 *
 * The microphone is opened *before* the answer is produced, so a denied
 * permission surfaces as a failure to answer rather than as a connected
 * call the customer can't be heard on.
 */
export async function answerIncomingCall(offerSdp: string): Promise<CallSession> {
  let localStream: MediaStream;
  try {
    localStream = (await mediaDevices.getUserMedia({ audio: true, video: false })) as MediaStream;
  } catch (err) {
    throw new MicrophoneUnavailableError(err);
  }

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const listeners: ((state: CallSessionState) => void)[] = [];
  let closed = false;

  const emit = (state: CallSessionState) => {
    for (const listener of listeners) listener(state);
  };

  const teardown = () => {
    if (closed) return;
    closed = true;
    // Order matters: stopping the tracks first releases the microphone
    // even if closing the connection throws, so the mic indicator never
    // stays lit after a call the user has already left.
    for (const track of localStream.getTracks()) track.stop();
    try {
      pc.close();
    } catch {
      // Already closed by the far end — nothing left to do.
    }
  };

  pc.onconnectionstatechange = () => {
    switch (pc.connectionState) {
      case 'connected':
        emit('connected');
        break;
      case 'failed':
        emit('failed');
        break;
      case 'disconnected':
      case 'closed':
        emit('ended');
        break;
      default:
        break;
    }
  };

  try {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }

    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offerSdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGathering(pc);

    // Read back from localDescription rather than reusing `answer`: that
    // object is the pre-gathering SDP, and sending it would hand Meta an
    // answer with no candidates in it at all.
    const answerSdp = pc.localDescription?.sdp;
    if (!answerSdp) {
      throw new Error('WebRTC produced no local description to answer with');
    }

    return {
      answerSdp,
      setMuted(muted: boolean) {
        for (const track of localStream.getAudioTracks()) {
          track.enabled = !muted;
        }
      },
      close: teardown,
      onStateChange(listener) {
        listeners.push(listener);
      },
    };
  } catch (err) {
    teardown();
    throw err;
  }
}
