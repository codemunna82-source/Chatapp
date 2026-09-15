import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import { requireVisibleConversation } from '../conversations/requireVisibleConversation.middleware';
import {
  sendMessageSchema,
  listMessagesQuerySchema,
  conversationIdParamSchema,
  messageIdParamSchema,
  deleteMessageQuerySchema,
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

// requireVisibleConversation runs before every handler below, so none of
// them repeats the check — and a route added later inherits it.
messageRouter.use(requireAuth, validate({ params: conversationIdParamSchema }), requireVisibleConversation);

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

// ?scope=me hides the message from this workspace; ?scope=everyone
// withdraws it from the customer's screen too, and works only on the
// private web chat — Meta's Cloud API cannot recall a delivered message.
// See messageRevoke.ts for the full rule.
messageRouter.delete(
  '/:messageId',
  requirePermission('CHAT_SEND'),
  validate({ params: messageIdParamSchema, query: deleteMessageQuerySchema }),
  deleteMessageHandler,
);
