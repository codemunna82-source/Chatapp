import { createHash } from 'node:crypto';
import { ApiError } from '../../lib/ApiError';
import { isCloudinaryConfigured, uploadBufferToCloudinary } from '../../integrations/cloudinary';
import { Media } from '../media/media.model';
import { findMediaBySha256 } from '../media/media.repository';
import { getMediaBytesForTenant } from '../media/media.service';
import { Message } from '../messages/message.model';
import type { GuestContext } from './guest.service';

/**
 * Images the customer sends from the web chat window.
 *
 * Deliberately not media.service.ts's uploadMediaForTenant: that function
 * pushes the bytes to Meta, which is exactly right for something being
 * sent to WhatsApp and exactly wrong here. This image is not going to
 * WhatsApp — the customer is in our own window — so a Meta round trip
 * would cost a call, require live Meta credentials, and put a customer's
 * photo on Meta's servers for no reason.
 */

/**
 * Wider than Meta's own list, because these files never reach Meta. WebP
 * in particular is what a modern phone camera roll hands a browser, and
 * refusing it would reject a large share of real uploads for a rule that
 * does not apply to this path.
 */
const GUEST_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const GUEST_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** Enough for a handful of photos at once without letting one request carry an album. */
export const GUEST_MAX_FILES_PER_REQUEST = 10;

export function assertGuestImage(mimeType: string, sizeBytes: number): void {
  if (!GUEST_IMAGE_TYPES.includes(mimeType)) {
    throw ApiError.badRequest('UNSUPPORTED_MEDIA_TYPE', 'Only images can be sent here.');
  }
  if (sizeBytes > GUEST_IMAGE_MAX_BYTES) {
    throw ApiError.badRequest('MEDIA_TOO_LARGE', 'That image is too large. The limit is 8 MB.');
  }
}

export interface StoreGuestImageInput {
  tenantId: string;
  whatsappPhoneNumberId: string;
  buffer: Buffer;
  mimeType: string;
}

/**
 * Cloudinary when it is configured, the database when it is not.
 *
 * Both are real destinations rather than one being a degraded mode: the
 * fallback keeps image sending working on a deployment that has never
 * heard of Cloudinary, and adding CLOUDINARY_URL later moves new uploads
 * across without touching anything already stored.
 */
export async function storeGuestImage(input: StoreGuestImageInput) {
  assertGuestImage(input.mimeType, input.buffer.length);

  const sha256 = createHash('sha256').update(input.buffer).digest('hex');
  // The same photo sent twice — a retry, or a customer resending — stores once.
  const existing = await findMediaBySha256(input.tenantId, sha256);
  if (existing) return existing;

  if (isCloudinaryConfigured()) {
    const uploaded = await uploadBufferToCloudinary(input.buffer, {
      folder: `voxo/${input.tenantId}/guest`,
      resourceType: 'image',
    });
    return Media.create({
      tenantId: input.tenantId,
      whatsappPhoneNumberId: input.whatsappPhoneNumberId,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.length,
      sha256,
      storageRef: uploaded.url,
      cloudinaryPublicId: uploaded.publicId,
      status: 'READY',
    });
  }

  return Media.create({
    tenantId: input.tenantId,
    whatsappPhoneNumberId: input.whatsappPhoneNumberId,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.length,
    sha256,
    // `db:` rather than a URL, so the byte-serving path can tell at a
    // glance where this file lives without loading it first.
    storageRef: `db:${sha256}`,
    bytes: input.buffer,
    status: 'READY',
  });
}

/**
 * Bytes for one image, for a customer holding a link.
 *
 * The ownership check is the whole point: media ids are guessable enough
 * that serving any of the tenant's files to any link holder would make
 * every customer's photos readable by every other one. A file is served
 * only if a message in *this* conversation actually references it.
 */
export async function getGuestMediaBytes(
  guest: GuestContext,
  mediaId: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const referenced = await Message.exists({
    tenantId: guest.tenantId,
    conversationId: guest.conversationId,
    mediaId,
    deletedAt: { $exists: false },
  });
  if (!referenced) {
    throw ApiError.notFound('MEDIA_NOT_FOUND', 'Media not found');
  }

  // Everything past the ownership check is the same problem the agent side
  // already solves — stored bytes, then Cloudinary, then Meta — so it uses
  // the same function rather than a second copy that could drift from it.
  return getMediaBytesForTenant(guest.tenantId, mediaId);
}
