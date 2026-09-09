import { createHash } from 'node:crypto';
import { ApiError } from '../../lib/ApiError';
import { isCloudinaryConfigured, uploadBufferToCloudinary } from '../../integrations/cloudinary';
import { Media } from '../media/media.model';
import { findMediaBySha256 } from '../media/media.repository';
import { getMediaBytesForTenant } from '../media/media.service';
import { Message } from '../messages/message.model';
import type { GuestContext } from './guest.service';

/**
 * Photos and voice notes the customer sends from the web chat window.
 *
 * Deliberately not media.service.ts's uploadMediaForTenant: that function
 * pushes the bytes to Meta, which is exactly right for something being
 * sent to WhatsApp and exactly wrong here. These files are not going to
 * WhatsApp — the customer is in our own window — so a Meta round trip
 * would cost a call, require live Meta credentials, and put a customer's
 * photo or recording on Meta's servers for no reason.
 */

/** What a stored guest file is, as far as the message that points at it cares. */
export type GuestMediaKind = 'image' | 'audio';

/**
 * Wider than Meta's own list, because these files never reach Meta. WebP
 * in particular is what a modern phone camera roll hands a browser, and
 * refusing it would reject a large share of real uploads for a rule that
 * does not apply to this path.
 */
const GUEST_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * What a browser's own recorder actually produces.
 *
 * Chrome and Firefox hand back Opus in a WebM container; Safari, including
 * every iPhone, hands back AAC in an MP4 one. Both have to be here or
 * voice notes work on half the phones that open the link. The rest are
 * what a customer might attach from their files rather than record.
 */
const GUEST_AUDIO_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/aac',
  'audio/wav',
  'audio/x-m4a',
];

export const GUEST_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/**
 * Roughly half an hour of Opus at the bitrate a browser records at, which
 * is far longer than anyone speaks into a chat window — the limit is here
 * to bound a request, not to cut anybody off.
 */
export const GUEST_AUDIO_MAX_BYTES = 16 * 1024 * 1024;
/** What multer is given, since one request may carry either kind. */
export const GUEST_UPLOAD_MAX_BYTES = Math.max(GUEST_IMAGE_MAX_BYTES, GUEST_AUDIO_MAX_BYTES);
/** Enough for a handful of photos at once without letting one request carry an album. */
export const GUEST_MAX_FILES_PER_REQUEST = 10;

/**
 * The kind, from a browser-supplied Content-Type.
 *
 * MediaRecorder reports its codec in the type — `audio/webm;codecs=opus` —
 * and matching that against a bare list rejects every recording Chrome
 * makes. Parameters are stripped before the comparison for exactly that
 * reason.
 */
export function guestMediaKind(mimeType: string): GuestMediaKind | null {
  const base = mimeType.split(';')[0]!.trim().toLowerCase();
  if (GUEST_IMAGE_TYPES.includes(base)) return 'image';
  if (GUEST_AUDIO_TYPES.includes(base)) return 'audio';
  return null;
}

export function assertGuestMedia(mimeType: string, sizeBytes: number): GuestMediaKind {
  const kind = guestMediaKind(mimeType);
  if (!kind) {
    throw ApiError.badRequest('UNSUPPORTED_MEDIA_TYPE', 'Only photos and voice messages can be sent here.');
  }

  const limit = kind === 'image' ? GUEST_IMAGE_MAX_BYTES : GUEST_AUDIO_MAX_BYTES;
  if (sizeBytes > limit) {
    throw ApiError.badRequest(
      'MEDIA_TOO_LARGE',
      kind === 'image'
        ? 'That image is too large. The limit is 8 MB.'
        : 'That recording is too long. The limit is 16 MB.',
    );
  }
  return kind;
}

export interface StoreGuestMediaInput {
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
export async function storeGuestMedia(input: StoreGuestMediaInput) {
  const kind = assertGuestMedia(input.mimeType, input.buffer.length);

  const sha256 = createHash('sha256').update(input.buffer).digest('hex');
  // The same photo sent twice — a retry, or a customer resending — stores once.
  const existing = await findMediaBySha256(input.tenantId, sha256);
  if (existing) return { media: existing, kind };

  if (isCloudinaryConfigured()) {
    const uploaded = await uploadBufferToCloudinary(input.buffer, {
      // Cloudinary files audio under its video resource type — there is no
      // audio one. Sending 'image' for a recording makes the upload fail.
      folder: `voxo/${input.tenantId}/guest`,
      resourceType: kind === 'image' ? 'image' : 'video',
    });
    const media = await Media.create({
      tenantId: input.tenantId,
      whatsappPhoneNumberId: input.whatsappPhoneNumberId,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.length,
      sha256,
      storageRef: uploaded.url,
      cloudinaryPublicId: uploaded.publicId,
      status: 'READY',
    });
    return { media, kind };
  }

  const media = await Media.create({
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
  return { media, kind };
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
