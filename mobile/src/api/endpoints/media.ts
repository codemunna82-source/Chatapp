import { apiClient, UPLOAD_TIMEOUT_MS } from '../client';
import { apiBaseUrl } from '../../utils/env';
import type { ApiSuccess, UploadedMedia } from '../types';

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
}

export async function uploadMedia(
  whatsappPhoneNumberId: string,
  file: PickedFile,
  /** Called with 0-1 as the bytes go up, so the bubble can draw a real bar. */
  onProgress?: (fraction: number) => void,
): Promise<UploadedMedia> {
  const form = new FormData();
  form.append('whatsappPhoneNumberId', whatsappPhoneNumberId);
  // React Native's fetch/FormData polyfill accepts this {uri, name, type}
  // shape directly — no need to read the file into memory ourselves first.
  form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);

  const res = await apiClient.post<ApiSuccess<UploadedMedia>>('/media/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: UPLOAD_TIMEOUT_MS,
    // React Native's XHR reports upload progress for multipart bodies, so
    // this is a real fraction of bytes sent rather than an animation on a
    // timer. `total` is absent on some platforms when the body is streamed;
    // reporting nothing then is honest, and leaves the bubble on its
    // indeterminate state rather than inventing a number.
    onUploadProgress: onProgress
      ? (e) => {
          if (!e.total) return;
          onProgress(Math.min(1, e.loaded / e.total));
        }
      : undefined,
  });
  return res.data.data;
}

/**
 * GET /api/media/:id requires the same bearer token as every other
 * request — see MediaImage's use of this.
 *
 * @param width the widest the image needs to be drawn, in PHYSICAL
 * pixels. The server snaps it up to a fixed ladder and resizes at
 * Cloudinary, so a chat bubble stops pulling the full photo out of
 * someone's camera roll to draw it at a fraction of its size. Omit it for
 * the original, which is what the full-screen viewer wants.
 */
export function mediaUrl(mediaId: string, width?: number): string {
  const base = `${apiBaseUrl}/media/${mediaId}`;
  return width ? `${base}?w=${width}` : base;
}

/**
 * A video's first frame, as an image.
 *
 * Not a variant of mediaUrl's width: this returns a DIFFERENT FILE — a
 * JPEG derived from the video — so a bubble can show what a video looks
 * like without pulling down the sixteen megabytes behind it. The server
 * answers 204 when it cannot derive one yet, which is an ordinary
 * "no poster", not an error.
 */
export function mediaPosterUrl(mediaId: string, width: number): string {
  return `${apiBaseUrl}/media/${mediaId}?poster=1&w=${width}`;
}
