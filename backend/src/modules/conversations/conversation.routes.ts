import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  listConversationsQuerySchema,
  updateConversationSchema,
  createConversationSchema,
  conversationIdParamSchema,
  bulkConversationSchema,
} from './conversation.validation';
import {
  listConversationsHandler,
  getConversationHandler,
  createConversationHandler,
  updateConversationHandler,
  deleteConversationHandler,
  bulkConversationsHandler,
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

// Multi-select actions. POST rather than PATCH because 'delete' is one of
// them, and a literal path rather than a method on '/:id' because it acts
// on a set, not on one conversation. No collision with '/:id': that is
// registered for GET, PATCH and DELETE only, never POST. Gated on
// CHAT_SEND, matching the single-chat archive/delete it batches.
conversationRouter.post(
  '/bulk',
  requirePermission('CHAT_SEND'),
  validate({ body: bulkConversationSchema }),
  bulkConversationsHandler,
);

// Deleting a chat removes it and its messages from this workspace only —
// nothing is recalled from the customer's WhatsApp (Meta's Cloud API has no
// such capability). Gated on CHAT_SEND rather than CHAT_READ.
conversationRouter.delete(
  '/:id',
  requirePermission('CHAT_SEND'),
  validate({ params: conversationIdParamSchema }),
  deleteConversationHandler,
);

// GET/POST /api/conversations/:id/messages — nested, own permission checks
// (CHAT_SEND/CHAT_MEDIA/CHAT_TEMPLATE) applied per-request in message.controller.ts.
conversationRouter.use('/:conversationId/messages', messageRouter);
