import { verifyAccessToken } from '../../lib/jwt';
import { ApiError } from '../../lib/ApiError';
import { createTtlCache } from '../../lib/ttlCache';
import { User, computeSubscriptionStatus } from '../users/user.model';
import type { Permission } from '../users/permission';
import type { AuthContext } from '../../types/express';

/**
 * Every authenticated request used to re-read the user document from
 * MongoDB — so a screen that fires four requests paid four round trips
 * before any of them started doing their own work, and the read happened
 * again for each poll, each pull-to-refresh and each socket re-validation.
 *
 * Ten seconds, and only successful resolutions are cached:
 *
 * - A disabled or expired account is never cached, so it keeps paying the
 *   full check on every request. That is the safe direction, and an
 *   account in that state is not generating traffic worth optimising.
 * - Changes the app itself makes — disabling a user, editing their role,
 *   permissions or validity window — call invalidateAuthContext and take
 *   effect immediately, so the window below never applies to an admin
 *   revoking access and watching it happen.
 * - What remains is the case nothing can signal: a validUntil that simply
 *   passes. Access ends up to ten seconds late. Access tokens already
 *   live for minutes, so this does not widen the real exposure.
 *
 * Per-process, so each instance of a scaled deployment holds its own copy;
 * an invalidation on one instance does not reach the others, which is the
 * same ten-second bound stated differently.
 */
const AUTH_CONTEXT_TTL_MS = 10_000;
const authContextCache = createTtlCache<AuthContext>({ ttlMs: AUTH_CONTEXT_TTL_MS, maxEntries: 5_000 });

function cacheKey(userId: string, tenantId: string): string {
  return `${userId}:${tenantId}`;
}

/** Called by every write that can change whether — or as whom — a user may act. */
export function invalidateAuthContext(userId: string, tenantId: string): void {
  authContextCache.delete(cacheKey(userId, tenantId));
}

/** Empties the cache. For tests, which share one process across suites. */
export function resetAuthContextCache(): void {
  authContextCache.clear();
}

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

  const key = cacheKey(claims.sub, claims.tenantId);
  const cached = authContextCache.get(key);
  if (cached) return cached;

  // Tenant-scoped lookup — never User.findById(claims.sub) alone.
  // Projected to just the fields the checks and the context below read:
  // this runs on every cache miss, and pulling the whole document to
  // examine five fields is bytes off the wire for nothing.
  const user = await User.findOne({ _id: claims.sub, tenantId: claims.tenantId })
    .select('status role permissions validFrom validUntil tenantId')
    .lean();
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

  const context: AuthContext = {
    userId: String(user._id),
    tenantId: String(user.tenantId),
    role: user.role as 'MASTER_ADMIN' | 'SUB_USER',
    permissions: (user.permissions ?? []) as Permission[],
  };

  // Only reached when every check above passed — see the note on the cache.
  authContextCache.set(key, context);
  return context;
}
