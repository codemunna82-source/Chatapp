import { createHash } from 'node:crypto';
import { ApiError } from '../../lib/ApiError';
import { recordAudit } from '../audit/auditLog.service';
import { validateMediaFile } from './media.validation';
import { createMedia, markMediaReady, findMediaBySha256, findMediaByIdAndTenant } from './media.repository';
import { resolveMetaCredentialsForPhoneNumber } from '../whatsapp/whatsapp.service';
import { getMetaGateway } from '../../integrations/meta';
import type { MediaDoc } from './media.model';

export interface UploadMediaInput {
  tenantId: string;
  actorUserId: string;
  whatsappPhoneNumberId: string;
  buffer: Buffer;
  mimeType: string;
  filename?: string;
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
    return ready ?? media;
  } catch (err) {
    media.status = 'FAILED';
    await media.save();
    throw err instanceof ApiError ? err : ApiError.internal('MEDIA_UPLOAD_FAILED', 'Failed to upload media to Meta');
  }
}

/**
 * Proxies media bytes from Meta — the access token needed to fetch them
 * must never reach Android (architecture doc §4), so this backend fetches
 * on the client's behalf and streams the result back. Retrieval is
 * deliberately on-demand rather than eager (see webhook.service.ts's
 * comment on inbound media) — no local object storage required.
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

  const credentials = await resolveMetaCredentialsForPhoneNumber(tenantId, String(media.whatsappPhoneNumberId));
  const gateway = getMetaGateway();
  const location = await gateway.retrieveMedia(credentials, media.metaMediaId);
  const buffer = await gateway.downloadMediaBinary(credentials, location.url);

  return { buffer, mimeType: location.mimeType || media.mimeType };
}
