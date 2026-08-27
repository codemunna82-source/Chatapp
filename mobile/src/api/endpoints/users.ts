import { apiClient } from '../client';
import { apiBaseUrl } from '../../utils/env';
import type { ApiSuccess, TeamMember } from '../types';

export interface PickedAvatarFile {
  uri: string;
  name: string;
  mimeType: string;
}

export async function uploadOwnAvatar(file: PickedAvatarFile): Promise<TeamMember> {
  const form = new FormData();
  // Same {uri, name, type} shape as media.ts's upload — React Native's
  // FormData polyfill accepts it directly, no need to read the file first.
  form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);

  const res = await apiClient.patch<ApiSuccess<TeamMember>>('/users/me/avatar', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.data;
}

/**
 * GET /api/users/:id/avatar requires the same bearer token as every other
 * request — see Avatar.tsx's use of this, same pattern as MediaImage/mediaUrl.
 * `version` should be the user's avatarUpdatedAt (or any string that
 * changes when the photo does) so a freshly-uploaded photo isn't served
 * from a stale cached copy at the same URL.
 */
export function userAvatarUrl(userId: string, version?: string): string {
  const v = version ? `?v=${encodeURIComponent(version)}` : '';
  return `${apiBaseUrl}/users/${userId}/avatar${v}`;
}
