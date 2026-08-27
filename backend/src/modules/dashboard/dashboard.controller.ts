import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { getDashboardSummary } from './dashboard.service';

export const getDashboardHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const summary = await getDashboardSummary(auth.tenantId);
  res.status(200).json({ success: true, data: summary });
});
