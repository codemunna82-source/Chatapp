import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { listNotificationsQuerySchema, notificationIdParamSchema } from './notification.validation';
import {
  listNotificationsHandler,
  markNotificationReadHandler,
  markAllNotificationsReadHandler,
} from './notification.controller';

export const notificationRouter = Router();

notificationRouter.use(requireAuth);

notificationRouter.get('/', validate({ query: listNotificationsQuerySchema }), listNotificationsHandler);
notificationRouter.post('/read-all', markAllNotificationsReadHandler);
notificationRouter.patch(
  '/:id/read',
  validate({ params: notificationIdParamSchema }),
  markNotificationReadHandler,
);
