import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import {
  listQuickRepliesForTenant,
  createQuickReplyForTenant,
  updateQuickReplyForTenant,
  deleteQuickReplyForTenant,
  recordQuickReplyUse,
} from './quickReply.service';

export const listQuickRepliesHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const items = await listQuickRepliesForTenant(auth.tenantId);
  res.status(200).json({ success: true, data: items });
});

export const createQuickReplyHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const item = await createQuickReplyForTenant(auth.tenantId, auth.userId, req.body as { title: string; body: string });
  res.status(201).json({ success: true, data: item });
});

export const updateQuickReplyHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const item = await updateQuickReplyForTenant(
    auth.tenantId,
    req.params.id as string,
    req.body as { title?: string; body?: string },
  );
  res.status(200).json({ success: true, data: item });
});

export const deleteQuickReplyHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  await deleteQuickReplyForTenant(auth.tenantId, req.params.id as string);
  res.status(200).json({ success: true, data: { id: req.params.id } });
});

/**
 * Separate from the send itself. The message goes out through the normal
 * message route whatever happens here — a usage counter is not worth
 * coupling to, or risking, a customer's reply being delivered.
 */
export const useQuickReplyHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  await recordQuickReplyUse(auth.tenantId, req.params.id as string);
  res.status(200).json({ success: true, data: { id: req.params.id } });
});
