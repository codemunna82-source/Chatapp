import { createHash } from 'node:crypto';
import { ApiError } from '../../lib/ApiError';
import { logger } from '../../lib/logger';
import { recordAudit } from '../audit/auditLog.service';
import { validateMediaFile } from './media.validation';
import {
  createMedia,
  markMediaReady,
  findMediaBySha256,
  findMediaWithBytesByIdAndTenant,
  setMediaCloudinaryRef,
} from './media.repository';
import { resolveMetaCredentialsForPhoneNumber } from '../whatsapp/whatsapp.service';
import { getMetaGateway } from '../../integrations/meta';
import { cloudinaryVariant, isCloudinaryConfigured, uploadBufferToCloudinary, fetchCloudinaryBuffer } from '../../integrations/cloudinary';
import type { MediaDoc } from './media.model';

export interface UploadMediaInput {
  tenantId: string;
  actorUserId: string;
  whatsappPhoneNumberId: string;
  buffer: Buffer;
  mimeType: string;
  filename?: string;
}

function cloudinaryFolderFor(tenantId: string): string {
  return `voxo/${tenantId}/media`;
}

export async function uploadMediaForTenant(input: UploadMediaInput): Promise<MediaDoc> {
  validateMediaFile(input.mimeType, input.buffer.length);

  const sha256 = createHash('sha256').update(input.buffer).digest('hex');

  // Dedupe: re-uploading the exact same file within a tenant reuses the
  // already-uploaded Meta media id rather than uploading (and paying for,
  // in Meta's storage lifetime terms) a duplicate.
  const existing = await findMediaBySha256(input.tenantId, sha256);
  if (existing) {
    return existing;
  }

  const media = await createMedia({
    tenantId: input.tenantId,
    whatsappPhoneNumberId: input.whatsappPhoneNumberId,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.length,
    sha256,
    storageRef: `pending:${sha256}`,
    status: 'UPLOADING',
  });

  try {
    const credentials = await resolveMetaCredentialsForPhoneNumber(input.tenantId, input.whatsappPhoneNumberId);
    const gateway = getMetaGateway();
    const result = await gateway.uploadMedia(credentials, {
      buffer: input.buffer,
      mimeType: input.mimeType,
      filename: input.filename,
    });

    const ready = await markMediaReady(String(media._id), input.tenantId, result.metaMediaId);
    await recordAudit({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: 'media.upload',
      targetType: 'Media',
      targetId: media._id,
      metadata: { mimeType: input.mimeType, sizeBytes: input.buffer.length },
    });

    // Cache to Cloudinary while the buffer is already in hand — never lets
    // a Cloudinary hiccup fail the upload, since the Meta upload above is
    // what actually matters for being able to send the message at all.
    if (isCloudinaryConfigured()) {
      try {
        const cached = await uploadBufferToCloudinary(input.buffer, {
          folder: cloudinaryFolderFor(input.tenantId),
          resourceType: 'auto',
        });
        const withRef = await setMediaCloudinaryRef(String(media._id), input.tenantId, cached.url, cached.publicId);
        return withRef ?? ready ?? media;
      } catch (err) {
        logger.warn({ err, mediaId: String(media._id) }, 'Cloudinary cache-write failed for outbound media upload');
      }
    }

    return ready ?? media;
  } catch (err) {
    media.status = 'FAILED';
    await media.save();
    throw err instanceof ApiError ? err : ApiError.internal('MEDIA_UPLOAD_FAILED', 'Failed to upload media to Meta');
  }
}

/**
 * Serves media bytes without ever handing the client a Meta or Cloudinary
 * URL/token directly (architecture doc §4). Checks the Cloudinary cache
 * first — real durability win, since Meta's own media ids/links expire
 * after ~30 days and re-fetching from Meta on every view is otherwise
 * unavoidable. Falls back to Meta (the original behavior) on a cache miss
 * or a Cloudinary error, and opportunistically writes the cache afterward
 * so the next read is fast — that write never blocks or fails this response.
 */
/**
 * Fetches in flight, keyed by tenant and media id.
 *
 * A photo arriving in a shared inbox is opened by several people within
 * seconds of each other, and every one of those requests used to run its
 * own pair of Meta round trips (retrieve the location, then download the
 * bytes) for the identical file. Now the first request does the work and
 * the rest await its promise.
 *
 * The entry is removed as soon as the fetch settles, so this is a
 * de-duplicator and not a cache — nothing is held in memory beyond the
 * request that asked for it, which matters when the payload is a video.
 */
const inFlightFetches = new Map<string, Promise<{ buffer: Buffer; mimeType: string }>>();

export async function getMediaBytesForTenant(
  tenantId: string,
  mediaId: string,
  /**
   * Longest edge to serve, when the file is an image held at Cloudinary.
   *
   * A chat bubble is a few hundred pixels wide and was being handed the
   * full photo out of someone's camera roll — several megabytes, on a
   * phone, on mobile data, for something displayed at a fraction of its
   * size. Cloudinary resizes from the URL, so asking for a bound costs
   * nothing extra.
   *
   * Ignored for anything not served from Cloudinary. There is no image
   * library in this process, and adding one to resize the handful of files
   * held directly in Mongo would be a large dependency for a small case —
   * those are served whole, which is correct, just bigger.
   */
  maxWidth?: number,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const key = `${tenantId}:${mediaId}:${maxWidth ?? 'full'}`;
  const inFlight = inFlightFetches.get(key);
  if (inFlight) return inFlight;

  const fetch = fetchMediaBytes(tenantId, mediaId, maxWidth).finally(() => {
    inFlightFetches.delete(key);
  });
  inFlightFetches.set(key, fetch);
  return fetch;
}

async function fetchMediaBytes(
  tenantId: string,
  mediaId: string,
  maxWidth?: number,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const media = await findMediaWithBytesByIdAndTenant(mediaId, tenantId);
  if (!media) {
    throw ApiError.notFound('MEDIA_NOT_FOUND', 'Media not found');
  }

  // Held here, so there is nothing to go and get. This is an image a
  // customer sent from the web chat window: it never went to WhatsApp and
  // has no Meta id, and the check below used to reject it as "not
  // finished uploading" — which is why those images never appeared in the
  // agent app at all.
  if (media.bytes) {
    return { buffer: Buffer.from(media.bytes), mimeType: media.mimeType };
  }

  if (media.storageRef.startsWith('https://')) {
    const wantsVariant = Boolean(maxWidth) && media.mimeType.startsWith('image/');
    const source = wantsVariant ? cloudinaryVariant(media.storageRef, maxWidth!) : media.storageRef;
    try {
      return { buffer: await fetchCloudinaryBuffer(source), mimeType: media.mimeType };
    } catch (err) {
      // A derived URL can fail on its own — an unsupported transformation,
      // a transformation quota — while the original is perfectly fine. The
      // original is tried before giving up, because falling straight
      // through to Meta turns a servable guest upload, which has no Meta id
      // at all, into "this media has not finished uploading".
      if (wantsVariant) {
        try {
          return { buffer: await fetchCloudinaryBuffer(media.storageRef), mimeType: media.mimeType };
        } catch (originalErr) {
          logger.warn({ err: originalErr, mediaId }, 'Cloudinary fetch failed for cached media — falling back to Meta');
        }
      } else {
        logger.warn({ err, mediaId }, 'Cloudinary fetch failed for cached media — falling back to Meta');
      }
    }
  }

  // Only now does a Meta id matter: it is what the fallback below needs,
  // not a precondition for serving a file we already have.
  if (!media.metaMediaId) {
    throw ApiError.badRequest('MEDIA_NOT_READY', 'This media has not finished uploading yet');
  }

  const credentials = await resolveMetaCredentialsForPhoneNumber(tenantId, String(media.whatsappPhoneNumberId));
  const gateway = getMetaGateway();
  const location = await gateway.retrieveMedia(credentials, media.metaMediaId);
  const buffer = await gateway.downloadMediaBinary(credentials, location.url);
  const mimeType = location.mimeType || media.mimeType;

  if (isCloudinaryConfigured()) {
    uploadBufferToCloudinary(buffer, { folder: cloudinaryFolderFor(tenantId), resourceType: 'auto' })
      .then((cached) => setMediaCloudinaryRef(String(media._id), tenantId, cached.url, cached.publicId))
      .catch((err) => logger.warn({ err, mediaId }, 'Cloudinary cache-write failed for inbound media fetch'));
  }

  return { buffer, mimeType };
}
