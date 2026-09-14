import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../../lib/ApiError';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { findVisibleConversation } from './conversation.repository';
import { visibleWhatsAppPhoneNumberId } from './conversation.access';

/**
 * Refuses a conversation the caller may not see, for every route nested
 * under /conversations/:conversationId.
 *
 * Route middleware rather than a check inside each handler: listing,
 * sending, starring and deleting all reach the same conversation through
 * the same URL, and four separate guards is four chances to forget one.
 *
 * 404 rather than 403 — see loadVisibleConversation in conversation.service
 * for why a scoped user is not told that a colleague's chat exists.
 *
 * The document it loaded is left on the request. Every handler below it
 * needs the same conversation, and fetching it again is a second round
 * trip to the database for a document already in memory — see
 * findVisibleConversation for what that cost on the send path.
 */
export async function requireVisibleConversation(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = getTenantContext(req);
    const conversationId = req.params.conversationId as string;
    const conversation = await findVisibleConversation(
      conversationId,
      auth.tenantId,
      visibleWhatsAppPhoneNumberId(auth),
    );
    if (!conversation) {
      throw ApiError.notFound('CONVERSATION_NOT_FOUND', 'Conversation not found');
    }
    req.visibleConversation = conversation;
    next();
  } catch (err) {
    next(err);
  }
}
