import { apiClient } from '../client';
import type { ApiSuccess } from '../types';

/**
 * Where the name customers see came from.
 *
 * 'settings'  — typed into this screen.
 * 'whatsapp'  — Meta's approved display name for the workspace's number.
 * 'workspace' — the workspace's own internal label, as a last resort.
 * 'fallback'  — nothing usable was set, so the window reads "Support".
 */
export type BusinessNameSource = 'settings' | 'whatsapp' | 'workspace' | 'fallback';

export interface TenantSettings {
  /** The workspace's internal label. Staff-facing only. */
  name: string;
  /** The override typed into this screen; empty when unset. */
  displayName: string;
  /** What a customer actually reads at the top of the web chat window. */
  customerFacingName: string;
  customerFacingNameSource: BusinessNameSource;
  /** Meta's approved name for the workspace's first number, if it has one. */
  whatsappVerifiedName: string;
}

export async function getTenantSettings(): Promise<TenantSettings> {
  const res = await apiClient.get<ApiSuccess<TenantSettings>>('/tenant/settings');
  return res.data.data;
}

/**
 * Sets the name customers see. An empty string is a real instruction —
 * "stop overriding" — so it is sent rather than skipped.
 */
export async function updateBusinessProfile(body: { displayName: string }): Promise<{
  displayName: string;
  customerFacingName: string;
  customerFacingNameSource: BusinessNameSource;
  whatsappVerifiedName: string;
}> {
  const res = await apiClient.patch<
    ApiSuccess<{
      displayName: string;
      customerFacingName: string;
      customerFacingNameSource: BusinessNameSource;
      whatsappVerifiedName: string;
    }>
  >('/tenant/settings/profile', body);
  return res.data.data;
}
