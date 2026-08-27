import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import * as authService from './auth.service';

function meta(req: Request) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body as { email: string; password: string };
  const result = await authService.login(email, password, meta(req));
  res.status(200).json({ success: true, data: result });
});

export const refreshHandler = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body as { refreshToken: string };
  const result = await authService.refresh(refreshToken, meta(req));
  res.status(200).json({ success: true, data: result });
});

export const logoutHandler = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body as { refreshToken: string };
  await authService.logout(refreshToken);
  res.status(200).json({ success: true, data: { loggedOut: true } });
});

export const changePasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
  await authService.changePassword(auth.userId, auth.tenantId, currentPassword, newPassword);
  res.status(200).json({ success: true, data: { changed: true } });
});
