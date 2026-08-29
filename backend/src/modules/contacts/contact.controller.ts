import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
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
  const { data, contentType } = await contactService.getContactAvatarForTenant(
    auth.tenantId,
    req.params.id as string,
  );
  res.setHeader('Content-Type', contentType);
  // Short private cache: the client already busts this with
  // avatarUpdatedAt, so this only spares repeat fetches within one session.
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.status(200).send(data);
});
