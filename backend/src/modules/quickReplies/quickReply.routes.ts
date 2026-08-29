import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  createQuickReplySchema,
  updateQuickReplySchema,
  quickReplyIdParamSchema,
} from './quickReply.validation';
import {
  listQuickRepliesHandler,
  createQuickReplyHandler,
  updateQuickReplyHandler,
  deleteQuickReplyHandler,
  useQuickReplyHandler,
} from './quickReply.controller';

export const quickReplyRouter = Router();

quickReplyRouter.use(requireAuth);

// Gated on the chat permissions rather than a new one: a saved reply is a
// message you are about to send, so anyone who can read the inbox can see
// the library and anyone who can send can curate it. Adding a permission
// for it would mean every existing team member losing access on deploy.
quickReplyRouter.get('/', requirePermission('CHAT_READ'), listQuickRepliesHandler);
quickReplyRouter.post('/', requirePermission('CHAT_SEND'), validate({ body: createQuickReplySchema }), createQuickReplyHandler);
quickReplyRouter.patch(
  '/:id',
  requirePermission('CHAT_SEND'),
  validate({ params: quickReplyIdParamSchema, body: updateQuickReplySchema }),
  updateQuickReplyHandler,
);
quickReplyRouter.delete(
  '/:id',
  requirePermission('CHAT_SEND'),
  validate({ params: quickReplyIdParamSchema }),
  deleteQuickReplyHandler,
);
quickReplyRouter.post(
  '/:id/use',
  requirePermission('CHAT_SEND'),
  validate({ params: quickReplyIdParamSchema }),
  useQuickReplyHandler,
);
