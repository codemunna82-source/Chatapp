import { apiClient } from '../client';
import type { ApiSuccess } from '../types';

/** The user's own WhatsApp connection, as reported by the server. */
export interface WhatsAppConnection {
  connected: boolean;
  displayPhoneNumber?: string;
  /**
   * The number an admin assigned this user, when they have not connected
   * one themselves — which is the ordinary case for a team member.
   *
   * Separate from `connected` on purpose: an assigned number is not
   * something the member can connect or disconnect, so it says which
   * number their messages go out from without claiming they own the
   * connection.
   */
  assignedPhoneNumber?: string;
  verifiedName?: string;
  phoneNumberId?: string;
  wabaId?: string;
  connectedAt?: string;
  /** Absent means the token does not expire — not that it expires now. */
  tokenExpiresAt?: string;
  /** Null when there is no expiry; negative once it has passed. */
  daysUntilExpiry?: number | null;
  /** The user must run Embedded Signup again — expired, or already rejected by Meta. */
  needsReconnect?: boolean;
}

export async function getWhatsAppConnection(): Promise<WhatsAppConnection> {
  const res = await apiClient.get<ApiSuccess<WhatsAppConnection>>('/whatsapp/status');
  return res.data.data;
}

/**
 * Hands the Embedded Signup authorization code to the server.
 *
 * Only the code travels. The server exchanges it for a token using the app
 * secret and stores it encrypted — no Meta credential ever exists in this
 * app's memory or storage.
 */
export async function connectWhatsApp(code: string): Promise<WhatsAppConnection> {
  const res = await apiClient.post<ApiSuccess<WhatsAppConnection>>('/whatsapp/connect', { code });
  return res.data.data;
}

export async function disconnectWhatsApp(): Promise<void> {
  await apiClient.post('/whatsapp/disconnect');
}
