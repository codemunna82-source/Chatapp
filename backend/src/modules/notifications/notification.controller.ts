import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { ApiError } from '../../lib/ApiError';
import { listNotificationsByUser, markNotificationRead, markAllNotificationsRead } from './notification.repository';

// Notifications are a personal mailbox — every authenticated user reads
// only their own (already tenant+userId scoped in the repository query),
// so this needs no chat/analytics permission, unlike the wallet/dashboard.
export const listNotificationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const result = await listNotificationsByUser(auth.tenantId, auth.userId, req.query as never);
  res.status(200).json({ success: true, data: result.items, meta: { nextCursor: result.nextCursor } });
});

export const markNotificationReadHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const notification = await markNotificationRead(req.params.id as string, auth.tenantId, auth.userId);
  if (!notification) {
    throw ApiError.notFound('NOTIFICATION_NOT_FOUND', 'Notification not found');
  }
  res.status(200).json({ success: true, data: notification });
});

export const markAllNotificationsReadHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const count = await markAllNotificationsRead(auth.tenantId, auth.userId);
  res.status(200).json({ success: true, data: { updated: count } });
});
