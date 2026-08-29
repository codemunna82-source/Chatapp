import { apiClient } from '../client';
import type { ApiSuccess, WhatsAppNumber } from '../types';

/** The workspace's own WhatsApp numbers. MASTER_ADMIN-only on the server —
 *  the only caller is the Team screen's "sends from" picker. */
export async function listWhatsAppNumbers(): Promise<WhatsAppNumber[]> {
  const res = await apiClient.get<ApiSuccess<WhatsAppNumber[]>>('/whatsapp/numbers');
  return res.data.data;
}
