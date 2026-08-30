import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { listPhoneNumbersForTenant, registerPhoneNumberForTenant } from './whatsapp.service';
import {
  connectWhatsAppForUser,
  disconnectWhatsAppForUser,
  getConnectionStatus,
} from './embeddedSignup.service';

export const listPhoneNumbersHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const items = await listPhoneNumbersForTenant(auth.tenantId);
  res.status(200).json({ success: true, data: items });
});

export const registerPhoneNumberHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const { phoneNumberId, wabaId } = req.body as { phoneNumberId: string; wabaId?: string };
  const number = await registerPhoneNumberForTenant(auth.tenantId, phoneNumberId, wabaId);
  res.status(201).json({ success: true, data: number });
});

export const connectWhatsAppHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const { code } = req.body as { code: string };
  // The connection is bound to auth.userId, never to anything in the body:
  // the client must not be able to connect a number on someone else's
  // behalf, nor claim a phone_number_id it did not onboard.
  const status = await connectWhatsAppForUser(auth.tenantId, auth.userId, code);
  res.status(200).json({ success: true, data: status });
});

export const whatsappStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const status = await getConnectionStatus(auth.tenantId, auth.userId);
  res.status(200).json({ success: true, data: status });
});

export const disconnectWhatsAppHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  await disconnectWhatsAppForUser(auth.tenantId, auth.userId);
  res.status(200).json({ success: true, data: { connected: false } });
});
