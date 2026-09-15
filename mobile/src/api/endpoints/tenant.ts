import { apiClient } from '../client';
import { apiBaseUrl } from '../../utils/env';
import type { PickedPhoto } from './contacts';
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
  /**
   * When the workspace's photo last changed, or null when it has none.
   *
   * Doubles as the cache-buster, exactly like a contact's — see
   * businessAvatarUrl below.
   */
  avatarUpdatedAt: string | null;
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
    // An older server sends nothing here, which reads as "no photo" —
    // the safe answer, since it only ever withholds a picture.
    avatarUpdatedAt: s.avatarUpdatedAt ?? null,
  };
}

/**
 * The workspace's photo, as a customer sees it above their chat window.
 *
 * Read through the same authenticated proxy every other avatar uses — the
 * Cloudinary URL never reaches a client, so one place decides who may see
 * this and it is the server. `version` is avatarUpdatedAt, so a newly
 * uploaded photo is a new URL rather than a stale one from a cache.
 */
export function businessAvatarUrl(version: string): string {
  return `${apiBaseUrl}/tenant/settings/profile/avatar?v=${encodeURIComponent(version)}`;
}

export async function uploadBusinessAvatar(file: PickedPhoto): Promise<{ avatarUpdatedAt: string }> {
  const form = new FormData();
  // RN's FormData takes this {uri,name,type} shape rather than a Blob.
  form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
  const res = await apiClient.patch<ApiSuccess<{ avatarUpdatedAt: string }>>(
    '/tenant/settings/profile/avatar',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return res.data.data;
}

export async function removeBusinessAvatar(): Promise<void> {
  await apiClient.delete('/tenant/settings/profile/avatar');
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
