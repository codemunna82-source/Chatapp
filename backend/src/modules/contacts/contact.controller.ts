import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import * as contactService from './contact.service';

export const createContactHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const contact = await contactService.createContactForTenant(auth.tenantId, auth.userId, req.body);
  res.status(201).json({ success: true, data: contact });
});

export const listContactsHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const result = await contactService.listContactsForTenant(auth.tenantId, req.query as never);
  res.status(200).json({ success: true, data: result.items, meta: { nextCursor: result.nextCursor } });
});

export const getContactHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const contact = await contactService.getContactForTenant(auth.tenantId, req.params.id as string);
  res.status(200).json({ success: true, data: contact });
});

export const updateContactHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const contact = await contactService.updateContactForTenant(
    auth.tenantId,
    auth.userId,
    req.params.id as string,
    req.body,
  );
  res.status(200).json({ success: true, data: contact });
});
