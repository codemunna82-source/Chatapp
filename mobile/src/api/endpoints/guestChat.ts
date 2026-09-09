import { apiClient } from '../client';
import type { ApiSuccess, Message } from '../types';

/**
 * The private web chat window a customer can be given a link to.
 *
 * A second channel to the same conversation: messages sent through it land
 * in this thread like any other, and it keeps working when Meta's 24-hour
 * window has closed — the customer is in our own page, not in WhatsApp.
 */

export interface GuestLinkStatus {
  active: boolean;
  expiresAt?: string;
}

export interface IssuedGuestLink {
  url: string;
  token: string;
  expiresAt: string;
}

/**
 * Whether a live window exists. Never the URL: the token is returned once,
 * at creation, and only its hash is stored — "there is one" is all that
 * can truthfully be said about a link already sent.
 */
export async function getGuestLinkStatus(conversationId: string): Promise<GuestLinkStatus> {
  const res = await apiClient.get<ApiSuccess<GuestLinkStatus>>(`/conversations/${conversationId}/guest/link`);
  return res.data.data;
}

/** Fails with GUEST_LINK_EXISTS if one is already live — revoke it first. */
export async function issueGuestLink(conversationId: string): Promise<IssuedGuestLink> {
  const res = await apiClient.post<ApiSuccess<IssuedGuestLink>>(`/conversations/${conversationId}/guest/link`);
  return res.data.data;
}

export async function revokeGuestLink(conversationId: string): Promise<{ revoked: number }> {
  const res = await apiClient.delete<ApiSuccess<{ revoked: number }>>(
    `/conversations/${conversationId}/guest/link`,
  );
  return res.data.data;
}

/**
 * A reply delivered to the web window instead of WhatsApp.
 *
 * Never reaches Meta, so it is not subject to the 24-hour window or to
 * template rules — which is the entire point: a customer sitting in the
 * chat window is reachable when WhatsApp says they are not.
 */
export async function sendGuestReply(conversationId: string, text: string): Promise<Message> {
  const res = await apiClient.post<ApiSuccess<Message>>(
    `/conversations/${conversationId}/guest/messages`,
    { text },
  );
  return res.data.data;
}
