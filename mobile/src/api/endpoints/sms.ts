import { apiClient } from '../client';
import type { ApiSuccess } from '../types';

/**
 * POST /api/sms/invite-link — the customer's own private chat link, to text
 * from this phone's SIM. Only the phone number is sent; SMS content never
 * leaves the device.
 */
export async function getSmsInviteLink(phone: string): Promise<{ url: string; expiresAt: string }> {
  const res = await apiClient.post<ApiSuccess<{ url: string; expiresAt: string }>>('/sms/invite-link', { phone });
  return res.data.data;
}
