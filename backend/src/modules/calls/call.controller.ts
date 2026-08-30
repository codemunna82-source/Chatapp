import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import * as callService from './call.service';

export const listCallsHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const result = await callService.listCallsForTenant(auth.tenantId, req.query as never);
  res.status(200).json({ success: true, data: result.items, meta: { nextCursor: result.nextCursor } });
});

export const initiateCallHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const result = await callService.initiateWhatsAppCall(auth.tenantId, auth.userId, req.body.contactId);
  res.status(201).json({ success: true, data: result });
});

export const answerCallHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const { sdp } = req.body as { sdp: string };
  const call = await callService.answerCallForUser(auth, req.params.callId as string, sdp);
  res.status(200).json({ success: true, data: call });
});

export const rejectCallHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const call = await callService.rejectCallForUser(auth, req.params.callId as string);
  res.status(200).json({ success: true, data: call });
});

export const hangUpCallHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const call = await callService.hangUpCallForUser(auth, req.params.callId as string);
  res.status(200).json({ success: true, data: call });
});
