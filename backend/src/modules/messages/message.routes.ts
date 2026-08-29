import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  sendMessageSchema,
  listMessagesQuerySchema,
  conversationIdParamSchema,
  messageIdParamSchema,
  starMessageSchema,
} from './message.validation';
import {
  listMessagesHandler,
  sendMessageHandler,
  deleteMessageHandler,
  starMessageHandler,
} from './message.controller';

// mergeParams: true — this router is mounted at
// /api/conversations/:conversationId/messages and needs req.params.conversationId.
export const messageRouter = Router({ mergeParams: true });

messageRouter.use(requireAuth, validate({ params: conversationIdParamSchema }));

messageRouter.get('/', requirePermission('CHAT_READ'), validate({ query: listMessagesQuerySchema }), listMessagesHandler);
messageRouter.post('/', requirePermission('CHAT_SEND'), validate({ body: sendMessageSchema }), sendMessageHandler);

// Starring is workspace-wide (see message.model.ts), so it is gated on
// CHAT_SEND rather than a new permission: anyone who can reply in a chat
// can flag a message in it as important.
messageRouter.patch(
  '/:messageId/star',
  requirePermission('CHAT_SEND'),
  validate({ params: messageIdParamSchema, body: starMessageSchema }),
  starMessageHandler,
);

// "Delete for me": hides the message from this workspace. There is no
// delete-for-everyone counterpart because Meta's Cloud API cannot recall a
// delivered message — see message.service.ts.
messageRouter.delete(
  '/:messageId',
  requirePermission('CHAT_SEND'),
  validate({ params: messageIdParamSchema }),
  deleteMessageHandler,
);
