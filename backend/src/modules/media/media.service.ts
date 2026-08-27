import { createHash } from 'node:crypto';
import { ApiError } from '../../lib/ApiError';
import { logger } from '../../lib/logger';
import { recordAudit } from '../audit/auditLog.service';
import { validateMediaFile } from './media.validation';
import { createMedia, markMediaReady, findMediaBySha256, findMediaByIdAndTenant, setMediaCloudinaryRef } from './media.repository';
import { resolveMetaCredentialsForPhoneNumber } from '../whatsapp/whatsapp.service';
import { getMetaGateway } from '../../integrations/meta';
import { isCloudinaryConfigured, uploadBufferToCloudinary, fetchCloudinaryBuffer } from '../../integrations/cloudinary';
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
export async function getMediaBytesForTenant(
  tenantId: string,
  mediaId: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const media = await findMediaByIdAndTenant(mediaId, tenantId);
  if (!media) {
    throw ApiError.notFound('MEDIA_NOT_FOUND', 'Media not found');
  }
  if (!media.metaMediaId) {
    throw ApiError.badRequest('MEDIA_NOT_READY', 'This media has not finished uploading yet');
  }

  if (media.storageRef.startsWith('https://')) {
    try {
      const buffer = await fetchCloudinaryBuffer(media.storageRef);
      return { buffer, mimeType: media.mimeType };
    } catch (err) {
      logger.warn({ err, mediaId }, 'Cloudinary fetch failed for cached media — falling back to Meta');
    }
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
