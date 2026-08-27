import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { ApiError } from '../../lib/ApiError';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import * as userService from './user.service';

export const createUserHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const user = await userService.createUserForTenant(auth.tenantId, auth.userId, req.body);
  res.status(201).json({ success: true, data: user });
});

export const listUsersHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const result = await userService.listUsersForTenant(auth.tenantId, req.query as never);
  res.status(200).json({ success: true, data: result.items, meta: { nextCursor: result.nextCursor } });
});

export const getUserHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const user = await userService.getUserForTenant(auth.tenantId, req.params.id as string);
  res.status(200).json({ success: true, data: user });
});

export const updateUserHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const user = await userService.updateUserForTenant(
    auth.tenantId,
    auth.userId,
    req.params.id as string,
    req.body,
  );
  res.status(200).json({ success: true, data: user });
});

export const disableUserHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const user = await userService.disableUserForTenant(auth.tenantId, auth.userId, req.params.id as string);
  res.status(200).json({ success: true, data: user });
});

export const updateOwnAvatarHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const file = req.file;
  if (!file) {
    throw ApiError.badRequest('FILE_REQUIRED', 'A file is required (multipart field name: "file")');
  }
  const user = await userService.updateOwnAvatar(auth.tenantId, auth.userId, file.buffer, file.mimetype);
  res.status(200).json({ success: true, data: user });
});

export const getUserAvatarHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const { data, contentType } = await userService.getUserAvatarForTenant(auth.tenantId, req.params.id as string);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.status(200).send(data);
});
