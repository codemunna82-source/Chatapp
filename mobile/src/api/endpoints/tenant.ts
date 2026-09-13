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

/**
 * Fills in fields an older server does not send yet.
 *
 * The app and the API ship separately, so a phone can always be running a
 * build newer than the server answering it. Reading
 * `customerFacingName.slice(...)` off such a response throws, and a throw
 * during render takes the whole screen down rather than one row of it.
 */
function normalize(s: Partial<TenantSettings>): TenantSettings {
  const displayName = s.displayName ?? '';
  const name = s.name ?? '';
  return {
    name,
    displayName,
    // Falls back the same way the server does, so the preview shows
    // something true rather than an empty header.
    customerFacingName: s.customerFacingName || displayName || name || 'Support',
    customerFacingNameSource: s.customerFacingNameSource ?? 'fallback',
    whatsappVerifiedName: s.whatsappVerifiedName ?? '',
  };
}

export async function getTenantSettings(): Promise<TenantSettings> {
  const res = await apiClient.get<ApiSuccess<Partial<TenantSettings>>>('/tenant/settings');
  return normalize(res.data.data);
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
  const res = await apiClient.patch<ApiSuccess<Partial<TenantSettings>>>(
    '/tenant/settings/profile',
    body,
  );
  const { name: _name, ...profile } = normalize(res.data.data);
  return profile;
}
