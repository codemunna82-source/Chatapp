import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { syncSmsMessages, sendSmsNow, resolveSmsConversationId, type SmsSyncItem } from './sms.service';
import { toRealtimeMessage } from '../../realtime/serializers';

export const syncSmsHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const { messages } = req.body as { messages: SmsSyncItem[] };
  const { created } = await syncSmsMessages(auth.tenantId, auth.userId, messages);
  res.status(200).json({ success: true, data: { created } });
});

export const sendSmsHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const item = req.body as SmsSyncItem;
  const message = await sendSmsNow(auth.tenantId, auth.userId, item);
  res.status(201).json({ success: true, data: toRealtimeMessage(message) });
});

export const resolveSmsConversationHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const { phone } = req.query as { phone: string };
  const conversationId = await resolveSmsConversationId(auth.tenantId, phone);
  res.status(200).json({ success: true, data: { conversationId } });
});
