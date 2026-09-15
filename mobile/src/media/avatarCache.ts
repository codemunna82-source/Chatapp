import { File, Paths } from 'expo-file-system';
import { contactAvatarUrl } from '../api/endpoints/contacts';

/**
 * Where an avatar's bytes live on this device, and how they get there.
 *
 * One module because two very different places need the same file: the
 * Avatar component drawing a chat list, and the notification builder
 * putting a face on a message that arrived while the app was closed. If
 * they named the file differently, every notification would re-download a
 * photo the list already had — over a mobile connection, inside a
 * background task with seconds to live.
 *
 * Downloaded rather than handed to an image loader as a URL, because the
 * avatar route is authenticated and neither React Native's Image nor
 * Android's notification loader sends the bearer token. (Avatar.tsx has
 * the full account of that; it is the same server and the same 401.)
 */

/** Keyed by photo VERSION, so a new upload is a new file rather than a
 *  stale one served from the same name. */
export function avatarCacheName(prefix: 'u' | 'c', id: string, version: string): string {
  return `voxo-avatar-${prefix}-${id}-${version.replace(/[^a-zA-Z0-9]/g, '')}.img`;
}

/**
 * A local `file://` path for a contact's photo, downloading it if this
 * device does not have it yet.
 *
 * Returns null for anything that does not resolve — no photo, no version,
 * offline, a 401 from an expired session. Every one of those has the same
 * answer at the call site: show the notification without a face rather
 * than not show it at all.
 */
export async function contactAvatarFile(
  contactId: string | undefined,
  version: string | undefined,
  accessToken: string | null | undefined,
): Promise<string | null> {
  // No version means the contact has never uploaded one — Avatar treats
  // this the same way and draws initials without touching the network.
  if (!contactId || !version) return null;

  try {
    const target = new File(Paths.cache, avatarCacheName('c', contactId, version));
    if (target.exists) return target.uri;
    if (!accessToken) return null;
    const result = await File.downloadFileAsync(contactAvatarUrl(contactId, version), target, {
      headers: { Authorization: `Bearer ${accessToken}` },
      idempotent: true,
    });
    return result.uri;
  } catch {
    return null;
  }
}
