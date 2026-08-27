import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  listConversationsQuerySchema,
  updateConversationSchema,
  conversationIdParamSchema,
} from './conversation.validation';
import { listConversationsHandler, getConversationHandler, updateConversationHandler } from './conversation.controller';
import { messageRouter } from '../messages/message.routes';

export const conversationRouter = Router();

conversationRouter.use(requireAuth, requirePermission('CHAT_READ'));

conversationRouter.get('/', validate({ query: listConversationsQuerySchema }), listConversationsHandler);
conversationRouter.get('/:id', validate({ params: conversationIdParamSchema }), getConversationHandler);
conversationRouter.patch(
  '/:id',
  validate({ params: conversationIdParamSchema, body: updateConversationSchema }),
  updateConversationHandler,
);

// GET/POST /api/conversations/:id/messages — nested, own permission checks
// (CHAT_SEND/CHAT_MEDIA/CHAT_TEMPLATE) applied per-request in message.controller.ts.
conversationRouter.use('/:conversationId/messages', messageRouter);
