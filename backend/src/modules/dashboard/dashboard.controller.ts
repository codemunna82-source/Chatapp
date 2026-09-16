import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { getDashboardSummary } from './dashboard.service';
import { visibleWhatsAppPhoneNumberId } from '../conversations/conversation.access';

export const getDashboardHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  // Scoped to the reader's own number unless they are a MASTER_ADMIN —
  // the same rule the chat list applies, which this screen was missing.
  const summary = await getDashboardSummary(auth.tenantId, visibleWhatsAppPhoneNumberId(auth));
  res.status(200).json({ success: true, data: summary });
});
