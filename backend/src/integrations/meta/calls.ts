import { metaRequest, authConfig } from './metaClient';
import type { MetaCredentials } from './types';

/**
 * WhatsApp Business Calling — the Graph calls that answer, refuse and end a
 * voice call on a Cloud API number.
 *
 * Audio itself never passes through this server. Meta and the agent's
 * device negotiate a WebRTC session directly; all that travels here is the
 * SDP the two sides exchange to find each other. Putting the media path on
 * the server would mean running a media server, paying for the bandwidth
 * twice, and adding a hop to every packet of a live conversation.
 */

interface CallActionResponse {
  success?: boolean;
  messaging_product?: string;
}

/**
 * Answering is two calls, not one, and the order is Meta's.
 *
 * `pre_accept` sends our SDP answer so media can start flowing while the
 * agent's side finishes setting up; `accept` then actually connects the
 * call. Skipping pre_accept is allowed but gives the caller a longer
 * silence at the start — the connection has to be built after the answer
 * rather than during it.
 */
export async function preAcceptCall(creds: MetaCredentials, callId: string, sdpAnswer: string): Promise<void> {
  await callAction(creds, { action: 'pre_accept', call_id: callId, session: { sdp: sdpAnswer, sdp_type: 'answer' } });
}

export async function acceptCall(creds: MetaCredentials, callId: string, sdpAnswer: string): Promise<void> {
  await callAction(creds, { action: 'accept', call_id: callId, session: { sdp: sdpAnswer, sdp_type: 'answer' } });
}

/** Declines a ringing call. Meta then sends a terminate webhook with status REJECTED. */
export async function rejectCall(creds: MetaCredentials, callId: string): Promise<void> {
  await callAction(creds, { action: 'reject', call_id: callId });
}

/** Hangs up a connected call from our side. Both parties are disconnected. */
export async function terminateCall(creds: MetaCredentials, callId: string): Promise<void> {
  await callAction(creds, { action: 'terminate', call_id: callId });
}

function callAction(creds: MetaCredentials, body: Record<string, unknown>): Promise<CallActionResponse> {
  return metaRequest<CallActionResponse>((client) =>
    client.post(
      `/${creds.phoneNumberId}/calls`,
      { messaging_product: 'whatsapp', ...body },
      authConfig(creds.accessToken),
    ),
  );
}
