import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../../lib/ApiError';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { conversationVisibleTo } from './conversation.repository';
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
 */
export async function requireVisibleConversation(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = getTenantContext(req);
    const conversationId = req.params.conversationId as string;
    const visible = await conversationVisibleTo(
      conversationId,
      auth.tenantId,
      visibleWhatsAppPhoneNumberId(auth),
    );
    if (!visible) {
      throw ApiError.notFound('CONVERSATION_NOT_FOUND', 'Conversation not found');
    }
    next();
  } catch (err) {
    next(err);
  }
}
