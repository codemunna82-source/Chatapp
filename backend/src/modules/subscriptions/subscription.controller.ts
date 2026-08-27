import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { ApiError } from '../../lib/ApiError';
import { getCurrentSubscription, computeCurrentStatus } from './subscription.repository';

/**
 * Returns the tenant's current plan plus a live-computed status — never
 * the stored `status` field alone, per the doc's rule that the sweep job
 * is a convenience cache and the real-time comparison is authoritative.
 */
export const getSubscriptionHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const subscription = await getCurrentSubscription(auth.tenantId);
  if (!subscription) {
    throw ApiError.notFound('SUBSCRIPTION_NOT_FOUND', 'No subscription record exists for this tenant');
  }
  res.status(200).json({
    success: true,
    data: {
      id: String(subscription._id),
      plan: subscription.plan,
      validFrom: subscription.validFrom,
      validUntil: subscription.validUntil,
      autoRenew: subscription.autoRenew,
      status: computeCurrentStatus(subscription),
    },
  });
});
