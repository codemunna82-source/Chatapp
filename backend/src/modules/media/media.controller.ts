import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { ApiError } from '../../lib/ApiError';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
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
  const { buffer, mimeType } = await getMediaBytesForTenant(auth.tenantId, req.params.id as string);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.status(200).send(buffer);
});
