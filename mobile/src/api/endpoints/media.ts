import { apiClient } from '../client';
import { apiBaseUrl } from '../../utils/env';
import type { ApiSuccess, UploadedMedia } from '../types';

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
}

export async function uploadMedia(whatsappPhoneNumberId: string, file: PickedFile): Promise<UploadedMedia> {
  const form = new FormData();
  form.append('whatsappPhoneNumberId', whatsappPhoneNumberId);
  // React Native's fetch/FormData polyfill accepts this {uri, name, type}
  // shape directly — no need to read the file into memory ourselves first.
  form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);

  const res = await apiClient.post<ApiSuccess<UploadedMedia>>('/media/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.data;
}

/** GET /api/media/:id requires the same bearer token as every other request — see MediaImage's use of this. */
export function mediaUrl(mediaId: string): string {
  return `${apiBaseUrl}/media/${mediaId}`;
}
