import { apiClient } from '../client';
import type { ApiSuccess, WhatsAppNumber } from '../types';

/** The workspace's own WhatsApp numbers. MASTER_ADMIN-only on the server —
 *  the only caller is the Team screen's "sends from" picker. */
export async function listWhatsAppNumbers(): Promise<WhatsAppNumber[]> {
  const res = await apiClient.get<ApiSuccess<WhatsAppNumber[]>>('/whatsapp/numbers');
  return res.data.data;
}

export interface RegisterWhatsAppNumberInput {
  /** Meta's numeric phone_number_id, from the API Setup page. */
  phoneNumberId: string;
  wabaId?: string;
}

/** Registers a real number. The server verifies it with Meta before saving,
 *  so a 400 here means Meta rejected the id or the access token. */
export async function registerWhatsAppNumber(input: RegisterWhatsAppNumberInput): Promise<WhatsAppNumber> {
  const res = await apiClient.post<ApiSuccess<WhatsAppNumber>>('/whatsapp/numbers', input);
  return res.data.data;
}

/**
 * Runs Meta's Cloud API registration for a number already added here.
 *
 * Adding a number in WhatsApp Manager and pasting its id is not enough:
 * until this runs Meta leaves it "Pending" and every send fails. Safe to
 * repeat — "already registered" comes back as success.
 */
export async function registerNumberForCloudApi(
  id: string,
): Promise<{ registered: boolean; message: string }> {
  const res = await apiClient.post<ApiSuccess<{ registered: boolean; message: string }>>(
    `/whatsapp/numbers/${id}/register`,
  );
  return res.data.data;
}
