import { verifyAccessToken } from '../../lib/jwt';
import { ApiError } from '../../lib/ApiError';
import { User, computeSubscriptionStatus } from '../users/user.model';
import type { Permission } from '../users/permission';
import type { AuthContext } from '../../types/express';

/**
 * The single chokepoint for "is this access token currently valid" —
 * verifies the JWT, then re-loads the user from the database (scoped by the
 * tenantId embedded in the token, never the reverse) to enforce *live*
 * account status and subscription-window checks. Used by both the HTTP
 * `requireAuth` middleware and the Socket.IO handshake/re-validation, so a
 * disabled account or expired subscription is denied identically on both
 * transports — never trust what the Android client believes (spec §10/§11).
 */
export async function resolveAuthContextFromToken(token: string): Promise<AuthContext> {
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

  return {
    userId: String(user._id),
    tenantId: String(user.tenantId),
    role: user.role as 'MASTER_ADMIN' | 'SUB_USER',
    permissions: (user.permissions ?? []) as Permission[],
  };
}
