import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import { sendMessageSchema, listMessagesQuerySchema, conversationIdParamSchema } from './message.validation';
import { listMessagesHandler, sendMessageHandler } from './message.controller';

// mergeParams: true — this router is mounted at
// /api/conversations/:conversationId/messages and needs req.params.conversationId.
export const messageRouter = Router({ mergeParams: true });

messageRouter.use(requireAuth, validate({ params: conversationIdParamSchema }));

messageRouter.get('/', requirePermission('CHAT_READ'), validate({ query: listMessagesQuerySchema }), listMessagesHandler);
messageRouter.post('/', requirePermission('CHAT_SEND'), validate({ body: sendMessageSchema }), sendMessageHandler);
