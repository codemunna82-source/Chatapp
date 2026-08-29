import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { registerDeviceToken, unregisterDeviceToken } from './deviceToken.repository';
import type { DevicePlatform } from './deviceToken.model';

export const registerDeviceHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const { token, platform } = req.body as { token: string; platform: DevicePlatform };
  await registerDeviceToken({ tenantId: auth.tenantId, userId: auth.userId, token, platform });
  res.status(200).json({ success: true, data: { registered: true } });
});

/**
 * Called on sign-out. Without it, the phone keeps receiving the workspace's
 * notifications after the user has logged out of it — which is both a
 * privacy problem and the kind of thing nobody notices until it happens to
 * a shared device.
 */
export const unregisterDeviceHandler = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body as { token: string };
  await unregisterDeviceToken(token);
  res.status(200).json({ success: true, data: { registered: false } });
});
