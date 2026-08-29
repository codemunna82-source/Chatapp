import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { ApiError } from '../../lib/ApiError';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { serveCachedAsset, IMMUTABLE_MAX_AGE_SECONDS } from '../../lib/httpAssetCache';
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
  const userId = req.params.id as string;
  const version = typeof req.query.v === 'string' ? req.query.v : undefined;

  // The client requests this with ?v=<avatarUpdatedAt> (see Avatar.tsx),
  // which makes each version of the photo its own URL and therefore
  // immutable. Without that param the URL means "whatever the current
  // photo is", so it only gets a short freshness window and must
  // revalidate — the ETag still turns that revalidation into a 304
  // rather than a re-download.
  if (
    serveCachedAsset(req, res, {
      etag: `"user-avatar-${userId}-${version ?? 'current'}"`,
      immutable: Boolean(version),
      maxAgeSeconds: version ? IMMUTABLE_MAX_AGE_SECONDS : 300,
    })
  ) {
    return;
  }

  const { data, contentType } = await userService.getUserAvatarForTenant(auth.tenantId, userId);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(data.length));
  res.status(200).send(data);
});
