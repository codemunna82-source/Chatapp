import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../lib/jwt';
import { ApiError } from '../lib/ApiError';
import { asyncHandler } from '../lib/asyncHandler';
import { User, computeSubscriptionStatus } from '../modules/users/user.model';
import type { Permission } from '../modules/users/permission';

/**
 * Verifies the JWT access token, then re-loads the user from the database
 * (scoped by the tenantId embedded in the token, never the reverse) to
 * enforce live account status and subscription-window checks. This is the
 * single chokepoint the spec requires: expired/disabled accounts are denied
 * here, server-side, regardless of what the Android client believes.
 */
export const requireAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw ApiError.unauthorized('AUTH_REQUIRED', 'Missing or malformed Authorization header');
  }
  const token = header.slice('Bearer '.length);

  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    throw ApiError.unauthorized('INVALID_TOKEN', 'Access token is invalid or expired');
  }

  // Tenant-scoped lookup — never User.findById(claims.sub) alone.
  const user = await User.findOne({ _id: claims.sub, tenantId: claims.tenantId }).lean();
  if (!user) {
    throw ApiError.unauthorized('INVALID_TOKEN', 'Account no longer exists');
  }
  if (user.status === 'DISABLED') {
    throw ApiError.forbidden('ACCOUNT_DISABLED', 'This account has been disabled');
  }

  const subscriptionStatus = computeSubscriptionStatus(user.validFrom, user.validUntil, user.status);
  if (subscriptionStatus === 'EXPIRED') {
    throw ApiError.forbidden('SUBSCRIPTION_EXPIRED', 'Subscription/validity window has expired');
  }
  if (subscriptionStatus === 'SUSPENDED') {
    throw ApiError.forbidden('ACCOUNT_DISABLED', 'This account is suspended');
  }

  req.auth = {
    userId: String(user._id),
    tenantId: String(user.tenantId),
    role: user.role as 'MASTER_ADMIN' | 'SUB_USER',
    permissions: (user.permissions ?? []) as Permission[],
  };

  next();
});
