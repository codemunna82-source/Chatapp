import { z } from 'zod';

export const listNotificationsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  unreadOnly: z.coerce.boolean().optional(),
});

export const notificationIdParamSchema = z.object({
  id: z.string().min(1),
});
