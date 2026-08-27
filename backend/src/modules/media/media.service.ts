import { createHash } from 'node:crypto';
import { ApiError } from '../../lib/ApiError';
import { recordAudit } from '../audit/auditLog.service';
import { validateMediaFile } from './media.validation';
import { createMedia, markMediaReady, findMediaBySha256 } from './media.repository';
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
