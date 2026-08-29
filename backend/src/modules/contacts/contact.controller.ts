import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { serveCachedAsset, IMMUTABLE_MAX_AGE_SECONDS } from '../../lib/httpAssetCache';
import { ApiError } from '../../lib/ApiError';
import * as contactService from './contact.service';

export const createContactHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const contact = await contactService.createContactForTenant(auth.tenantId, auth.userId, req.body);
  res.status(201).json({ success: true, data: contact });
});

export const listContactsHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const result = await contactService.listContactsForTenant(auth.tenantId, req.query as never);
  res.status(200).json({ success: true, data: result.items, meta: { nextCursor: result.nextCursor } });
});

export const getContactHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const contact = await contactService.getContactForTenant(auth.tenantId, req.params.id as string);
  res.status(200).json({ success: true, data: contact });
});

export const deleteContactHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  await contactService.deleteContactForTenant(auth.tenantId, req.params.id as string, auth.userId);
  res.status(200).json({ success: true, data: { id: req.params.id } });
});

export const updateContactHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const contact = await contactService.updateContactForTenant(
    auth.tenantId,
    auth.userId,
    req.params.id as string,
    req.body,
  );
  res.status(200).json({ success: true, data: contact });
});

export const updateContactAvatarHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const file = req.file;
  if (!file) {
    throw ApiError.badRequest('AVATAR_FILE_REQUIRED', 'Attach an image as the "file" field.');
  }
  const contact = await contactService.updateContactAvatar(
    auth.tenantId,
    req.params.id as string,
    auth.userId,
    file.buffer,
    file.mimetype,
  );
  res.status(200).json({ success: true, data: contact });
});

export const getContactAvatarHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const contactId = req.params.id as string;
  const version = typeof req.query.v === 'string' ? req.query.v : undefined;

  // The client requests this with ?v=<avatarUpdatedAt> (see Avatar.tsx),
  // which makes each version of the photo its own URL and therefore
  // immutable. Without that param the URL means "whatever the current
  // photo is", so it only gets a short freshness window and must
  // revalidate — the ETag still turns that revalidation into a 304
  // rather than a re-download.
  if (
    serveCachedAsset(req, res, {
      etag: `"contact-avatar-${contactId}-${version ?? 'current'}"`,
      immutable: Boolean(version),
      maxAgeSeconds: version ? IMMUTABLE_MAX_AGE_SECONDS : 300,
    })
  ) {
    return;
  }

  const { data, contentType } = await contactService.getContactAvatarForTenant(auth.tenantId, contactId);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(data.length));
  res.status(200).send(data);
});
