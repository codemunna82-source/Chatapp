import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { ApiError } from '../../lib/ApiError';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { serveCachedAsset, IMMUTABLE_MAX_AGE_SECONDS } from '../../lib/httpAssetCache';
import { uploadMediaForTenant, getMediaBytesForTenant } from './media.service';

export const uploadMediaHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const file = req.file;
  if (!file) {
    throw ApiError.badRequest('FILE_REQUIRED', 'A file is required (multipart field name: "file")');
  }
  const { whatsappPhoneNumberId } = req.body as { whatsappPhoneNumberId: string };

  const media = await uploadMediaForTenant({
    tenantId: auth.tenantId,
    actorUserId: auth.userId,
    whatsappPhoneNumberId,
    buffer: file.buffer,
    mimeType: file.mimetype,
    filename: file.originalname,
  });

  res.status(201).json({
    success: true,
    data: {
      id: String(media._id),
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      status: media.status,
    },
  });
});

export const getMediaHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const mediaId = req.params.id as string;

  // The bytes behind a media id never change — WhatsApp media is written
  // once and referenced by an immutable id — so the id IS the validator,
  // and this answers before the fetch below ever runs. It used to be
  // max-age=3600 with no validator, which had every device re-downloading
  // every photo in a thread once an hour for bytes that had not moved.
  if (
    serveCachedAsset(req, res, {
      etag: `"media-${mediaId}"`,
      immutable: true,
      maxAgeSeconds: IMMUTABLE_MAX_AGE_SECONDS,
    })
  ) {
    return;
  }

  const { buffer, mimeType } = await getMediaBytesForTenant(auth.tenantId, mediaId);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Length', String(buffer.length));
  res.status(200).send(buffer);
});
