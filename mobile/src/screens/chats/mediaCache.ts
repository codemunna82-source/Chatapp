import { File, Paths } from 'expo-file-system';
import { mediaUrl } from '../../api/endpoints/media';

/**
 * Downloads a media file once and keeps it on disk.
 *
 * The media endpoint needs the same bearer token as every other request —
 * the Meta access token never reaches the client, so the bytes come
 * through our own proxy — and RN's Image drops `headers` off a source
 * object on Android. So the file is fetched with the token and rendered
 * from its local path afterwards, which also means a bubble scrolling
 * back into view costs nothing.
 *
 * The width is part of the filename. A thumbnail and the original are two
 * different files for one media id, and sharing a name between them would
 * have the full-screen viewer open whatever the bubble happened to
 * download first.
 */
export function cachedMediaFile(mediaId: string, width?: number): File {
  return new File(Paths.cache, `voxo-media-${mediaId}-w${width ?? 'full'}.img`);
}

export async function downloadMedia(
  mediaId: string,
  accessToken: string | null,
  width?: number,
): Promise<string> {
  const target = cachedMediaFile(mediaId, width);
  // Already here, from a previous mount or an earlier session.
  if (target.exists) return target.uri;

  const result = await File.downloadFileAsync(mediaUrl(mediaId, width), target, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    idempotent: true,
  });
  return result.uri;
}
