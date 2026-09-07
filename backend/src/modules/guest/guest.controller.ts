import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { getGuestContext } from '../../middleware/guestAuth.middleware';
import * as guestService from './guest.service';

/* ------------------------------------------------------------------ *
 * Customer-facing — authenticated by the web-chat link, not a login.  *
 * ------------------------------------------------------------------ */

export const getGuestSessionHandler = asyncHandler(async (req: Request, res: Response) => {
  const guest = getGuestContext(req);
  res.status(200).json({ success: true, data: await guestService.getGuestSessionView(guest) });
});

export const listGuestMessagesHandler = asyncHandler(async (req: Request, res: Response) => {
  const guest = getGuestContext(req);
  const { cursor, limit } = req.query as { cursor?: string; limit?: number };
  const result = await guestService.listGuestMessages(guest, { cursor, limit });
  res.status(200).json({ success: true, data: result.items, meta: { nextCursor: result.nextCursor } });
});

export const postGuestMessageHandler = asyncHandler(async (req: Request, res: Response) => {
  const guest = getGuestContext(req);
  const { text } = req.body as { text: string };
  res.status(201).json({ success: true, data: await guestService.postGuestMessage(guest, text) });
});

export const markGuestReadHandler = asyncHandler(async (req: Request, res: Response) => {
  const guest = getGuestContext(req);
  res.status(200).json({ success: true, data: await guestService.markBusinessMessagesRead(guest) });
});

/* ------------------------------------------------------------------ *
 * Agent-facing — ordinary authenticated routes on a conversation.     *
 * ------------------------------------------------------------------ */

export const issueGuestLinkHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const conversationId = req.params.conversationId as string;
  res.status(201).json({
    success: true,
    data: await guestService.issueGuestLinkForConversation(auth, conversationId),
  });
});

export const revokeGuestLinkHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const conversationId = req.params.conversationId as string;
  res.status(200).json({
    success: true,
    data: await guestService.revokeGuestLinkForConversation(auth, conversationId),
  });
});

export const sendGuestReplyHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const conversationId = req.params.conversationId as string;
  const { text } = req.body as { text: string };
  res.status(201).json({ success: true, data: await guestService.sendGuestReply(auth, conversationId, text) });
});
