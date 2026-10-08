import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { getTemplateStats } from './templateStats.service';

/** Bounds on `?days=`, clamped rather than rejected — a typo in the URL
 *  should fall back to something sane, not 400 an admin's bookmark. */
const MIN_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 90;
const DEFAULT_WINDOW_DAYS = 30;

function resolveWindowDays(raw: unknown): number {
  const parsed = typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_WINDOW_DAYS;
  return Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, Math.round(parsed)));
}

export const getTemplateStatsHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const stats = await getTemplateStats(auth.tenantId, resolveWindowDays(req.query.days));
  res.status(200).json({ success: true, data: stats });
});
