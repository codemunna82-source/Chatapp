import { Types } from 'mongoose';
import { Notification, type NotificationDoc, type NotificationType } from './notification.model';

export interface CreateNotificationInput {
  tenantId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export async function createNotification(input: CreateNotificationInput): Promise<NotificationDoc> {
  return Notification.create(input);
}

export async function listNotificationsByUser(
  tenantId: string,
  userId: string,
  opts: { cursor?: string; limit?: number; unreadOnly?: boolean } = {},
): Promise<{ items: NotificationDoc[]; nextCursor: string | null }> {
  const limit = Math.min(opts.limit ?? 30, 100);
  const filter: Record<string, unknown> = { tenantId, userId };
  if (opts.unreadOnly) filter.readAt = null;
  if (opts.cursor && Types.ObjectId.isValid(opts.cursor)) {
    filter._id = { $lt: new Types.ObjectId(opts.cursor) };
  }
  const items = await Notification.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1);
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return { items: page, nextCursor: hasMore ? String(page[page.length - 1]!._id) : null };
}

export async function markNotificationRead(
  id: string,
  tenantId: string,
  userId: string,
): Promise<NotificationDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return Notification.findOneAndUpdate({ _id: id, tenantId, userId }, { $set: { readAt: new Date() } }, { new: true });
}
