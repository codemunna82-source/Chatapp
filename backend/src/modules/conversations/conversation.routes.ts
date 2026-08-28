import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  listConversationsQuerySchema,
  updateConversationSchema,
  createConversationSchema,
  conversationIdParamSchema,
} from './conversation.validation';
import {
  listConversationsHandler,
  getConversationHandler,
  createConversationHandler,
  updateConversationHandler,
} from './conversation.controller';
import { messageRouter } from '../messages/message.routes';

export const conversationRouter = Router();

conversationRouter.use(requireAuth, requirePermission('CHAT_READ'));

conversationRouter.get('/', validate({ query: listConversationsQuerySchema }), listConversationsHandler);
conversationRouter.get('/:id', validate({ params: conversationIdParamSchema }), getConversationHandler);

// Starting a chat is a send-side action, so it needs CHAT_SEND rather than
// the baseline CHAT_READ the rest of this router requires.
conversationRouter.post(
  '/',
  requirePermission('CHAT_SEND'),
  validate({ body: createConversationSchema }),
  createConversationHandler,
);
conversationRouter.patch(
  '/:id',
  validate({ params: conversationIdParamSchema, body: updateConversationSchema }),
  updateConversationHandler,
);

// GET/POST /api/conversations/:id/messages — nested, own permission checks
// (CHAT_SEND/CHAT_MEDIA/CHAT_TEMPLATE) applied per-request in message.controller.ts.
conversationRouter.use('/:conversationId/messages', messageRouter);
