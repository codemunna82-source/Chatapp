import { File, Paths } from 'expo-file-system';
import { mediaPosterUrl, mediaUrl } from '../../api/endpoints/media';

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

/**
 * A video's poster frame, cached like any other media file.
 *
 * Returns null when the server has no poster for this video yet — it
 * answers 204, which arrives here as a zero-length file. The empty file
 * is deleted rather than kept, so the next view asks again: a video
 * uncached at the server on Monday has a poster once anyone has opened
 * it, and a cached emptiness would hide that forever.
 */
/**
 * The video file itself.
 *
 * A separate function only because the extension matters: ExoPlayer picks
 * its extractor from it, and a file with no suffix is guessed at.
 */
export async function downloadVideo(mediaId: string, accessToken: string | null): Promise<string> {
  const target = new File(Paths.cache, `voxo-media-${mediaId}.mp4`);
  if (target.exists) return target.uri;

  const result = await File.downloadFileAsync(mediaUrl(mediaId), target, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    idempotent: true,
  });
  return result.uri;
}

export async function downloadPoster(
  mediaId: string,
  accessToken: string | null,
  width: number,
): Promise<string | null> {
  const target = new File(Paths.cache, `voxo-poster-${mediaId}-w${width}.jpg`);
  if (target.exists) return target.size > 0 ? target.uri : null;

  const result = await File.downloadFileAsync(mediaPosterUrl(mediaId, width), target, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    idempotent: true,
  });
  if (result.size === 0) {
    result.delete();
    return null;
  }
  return result.uri;
}
