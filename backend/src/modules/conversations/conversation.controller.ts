import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { assertPermission } from '../../middleware/rbac.middleware';
import * as conversationService from './conversation.service';

export const listConversationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const result = await conversationService.listConversationsForTenant(auth.tenantId, req.query as never);
  res.status(200).json({ success: true, data: result.items, meta: { nextCursor: result.nextCursor } });
});

export const getConversationHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const conversation = await conversationService.getConversationForTenant(auth.tenantId, req.params.id as string);
  res.status(200).json({ success: true, data: conversation });
});

export const createConversationHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const { contactId } = req.body as { contactId: string };
  const conversation = await conversationService.startConversationForTenant(auth.tenantId, contactId, auth.userId);
  res.status(200).json({ success: true, data: conversation });
});

export const bulkConversationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const { ids, action } = req.body as { ids: string[]; action: conversationService.BulkConversationAction };
  const result = await conversationService.bulkUpdateConversationsForTenant(auth.tenantId, auth.userId, ids, action);
  res.status(200).json({ success: true, data: result });
});

export const deleteConversationHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  await conversationService.deleteConversationForTenant(auth.tenantId, req.params.id as string, auth.userId);
  res.status(200).json({ success: true, data: { id: req.params.id } });
});

export const updateConversationHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const patch = req.body as conversationService.UpdateConversationBody;

  // Pinning specifically needs CHAT_PIN (spec §9) — everything else on this
  // route only needs the baseline CHAT_READ already required to reach it.
  if (patch.pinned !== undefined) {
    assertPermission(auth, 'CHAT_PIN');
  }

  const conversation = await conversationService.updateConversationForTenant(
    auth.tenantId,
    auth.userId,
    req.params.id as string,
    patch,
  );
  res.status(200).json({ success: true, data: conversation });
});
