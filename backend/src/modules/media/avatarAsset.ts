import { ApiError } from '../../lib/ApiError';
import {
  deleteCloudinaryAsset,
  isCloudinaryConfigured,
  uploadBufferToCloudinary,
} from '../../integrations/cloudinary';
import { AVATAR_MAX_SIZE_BYTES, AVATAR_MIME_TYPES } from '../users/user.service';

/**
 * The part of "set a photo" that is the same for every subject.
 *
 * A user's photo, a contact's and now a workspace's are stored
 * identically — validate, upload to Cloudinary, swap the reference, bin
 * the old asset — and the first two had written that out in full, twice.
 * A third copy is the point at which the sequence stops being a
 * coincidence and starts being a rule, and where a fix to one copy would
 * quietly not reach the others.
 *
 * Deliberately does NOT own the database write. Each subject has its own
 * collection, its own tenant scoping and its own audit line, and folding
 * those in would make this a switch statement pretending to be a helper.
 * It owns the bytes; the caller owns the row.
 *
 * The existing user and contact services still have their own copies.
 * They work, they are tested, and rewriting them was not what this change
 * was for — but this is where they should come when either is next
 * touched.
 */

/** Rejects what should never reach Cloudinary. Throws rather than
 *  returning a result, because every caller's next line is the upload. */
export function assertUsableAvatar(data: Buffer, contentType: string): void {
  if (!AVATAR_MIME_TYPES.includes(contentType)) {
    throw ApiError.badRequest(
      'UNSUPPORTED_AVATAR_TYPE',
      `Unsupported image type "${contentType}" — use JPEG, PNG, or WebP`,
    );
  }
  if (data.length > AVATAR_MAX_SIZE_BYTES) {
    throw ApiError.badRequest(
      'AVATAR_TOO_LARGE',
      `Image is ${(data.length / (1024 * 1024)).toFixed(1)}MB — must be under ${AVATAR_MAX_SIZE_BYTES / (1024 * 1024)}MB`,
    );
  }
  if (!isCloudinaryConfigured()) {
    throw ApiError.internal(
      'CLOUDINARY_NOT_CONFIGURED',
      'Photo storage is not configured on this server (CLOUDINARY_URL is unset)',
    );
  }
}

/** Removes the asset a row no longer points at.
 *
 *  Called only AFTER the new one is stored, and never fatally: an orphaned
 *  old image costs storage, where a failed delete that rolled back the
 *  upload would cost someone their photo. */
export async function forgetPreviousAvatar(publicId: string | null | undefined): Promise<void> {
  if (!publicId) return;
  await deleteCloudinaryAsset(publicId).catch(() => undefined);
}

export { uploadBufferToCloudinary, AVATAR_MAX_SIZE_BYTES, AVATAR_MIME_TYPES };
