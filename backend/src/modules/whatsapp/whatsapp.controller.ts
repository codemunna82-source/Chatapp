import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { listPhoneNumbersForTenant, registerPhoneNumberForTenant } from './whatsapp.service';

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
