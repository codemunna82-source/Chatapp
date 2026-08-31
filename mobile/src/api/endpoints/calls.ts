import { apiClient } from '../client';
import type { ApiSuccess, CallLog, InitiateCallResult } from '../types';

export interface ListCallsParams {
  cursor?: string;
  limit?: number;
}

export async function listCalls(params: ListCallsParams): Promise<{ items: CallLog[]; nextCursor: string | null }> {
  const res = await apiClient.get<ApiSuccess<CallLog[]>>('/calls', { params });
  return { items: res.data.data, nextCursor: res.data.meta?.nextCursor ?? null };
}

export async function initiateCall(contactId: string): Promise<InitiateCallResult> {
  const res = await apiClient.post<ApiSuccess<InitiateCallResult>>('/calls', { contactId });
  return res.data.data;
}

/** What `GET /calls/pending` returns — the same shape as the `call:incoming` socket event. */
export interface PendingCall {
  callId: string;
  callLogId: string;
  contactId: string;
  contactName?: string;
  fromPhone: string;
  sdpOffer?: string;
}

/**
 * The call ringing on this user's number right now, or null.
 *
 * Needed because a push notification wakes the app but the socket event
 * that carried the WebRTC offer was delivered while it was closed, and
 * Socket.IO replays nothing. Without this an agent opens VOXO to a phone
 * that is still ringing and no way to pick it up.
 */
export async function fetchPendingCall(): Promise<PendingCall | null> {
  const res = await apiClient.get<ApiSuccess<PendingCall | null>>('/calls/pending');
  return res.data.data ?? null;
}

/**
 * Answers a ringing WhatsApp call with the SDP this device produced.
 *
 * The `callId` is Meta's own id, taken from the `call:incoming` socket
 * event. The backend re-checks that the call arrived on this user's own
 * number before forwarding anything to Meta, so a stale or guessed id
 * comes back as a 404 rather than connecting someone else's call.
 */
export async function answerCall(callId: string, sdp: string): Promise<CallLog> {
  const res = await apiClient.post<ApiSuccess<CallLog>>(`/calls/${encodeURIComponent(callId)}/answer`, { sdp });
  return res.data.data;
}

/** Declines a ringing call. Meta then sends the terminate webhook. */
export async function rejectCall(callId: string): Promise<CallLog> {
  const res = await apiClient.post<ApiSuccess<CallLog>>(`/calls/${encodeURIComponent(callId)}/reject`, {});
  return res.data.data;
}

/** Hangs up a connected call. The terminate webhook records the duration. */
export async function hangUpCall(callId: string): Promise<CallLog> {
  const res = await apiClient.post<ApiSuccess<CallLog>>(`/calls/${encodeURIComponent(callId)}/hangup`, {});
  return res.data.data;
}
