import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import { requireVisibleConversation } from '../conversations/requireVisibleConversation.middleware';
import { guestConversationIdParamSchema, guestReplySchema } from './guest.validation';
import { issueGuestLinkHandler, revokeGuestLinkHandler, sendGuestReplyHandler } from './guest.controller';

/**
 * The agent's side of the web chat, mounted at
 * /api/conversations/:conversationId/guest — issuing the link that goes
 * into a WhatsApp thread, taking it back, and replying into the web window
 * rather than through Meta.
 *
 * mergeParams so :conversationId from the parent mount is visible here,
 * the same as messageRouter.
 */
export const guestAdminRouter = Router({ mergeParams: true });

guestAdminRouter.use(
  requireAuth,
  validate({ params: guestConversationIdParamSchema }),
  requireVisibleConversation,
);

// Handing a customer a private channel into this conversation is a
// send-side action, so it is gated on CHAT_SEND rather than the CHAT_READ
// that merely reaching the conversation requires.
guestAdminRouter.post('/link', requirePermission('CHAT_SEND'), issueGuestLinkHandler);
guestAdminRouter.delete('/link', requirePermission('CHAT_SEND'), revokeGuestLinkHandler);
guestAdminRouter.post(
  '/messages',
  requirePermission('CHAT_SEND'),
  validate({ body: guestReplySchema }),
  sendGuestReplyHandler,
);
