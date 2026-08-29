import { randomUUID, createHash } from 'node:crypto';
import { User, computeSubscriptionStatus } from '../users/user.model';
import { RefreshToken } from './refreshToken.model';
import { hashPassword, verifyPassword } from '../../lib/password';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt';
import { ApiError } from '../../lib/ApiError';
import { recordAudit } from '../audit/auditLog.service';
import { env } from '../../config/env';
import type { Permission } from '../users/permission';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function ttlToMs(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 30 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2];
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit as 's' | 'm' | 'h' | 'd'];
  return value * unitMs;
}

interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    tenantId: string;
    email: string;
    role: 'MASTER_ADMIN' | 'SUB_USER';
    permissions: Permission[];
    displayName?: string;
    avatarUpdatedAt?: string;
  };
}

async function issueTokenPair(
  userId: string,
  tenantId: string,
  role: 'MASTER_ADMIN' | 'SUB_USER',
  family: string,
  meta: RequestMeta,
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = signAccessToken({ sub: userId, tenantId, role });

  const jti = randomUUID();
  const refreshToken = signRefreshToken({ sub: userId, tenantId, jti });

  await RefreshToken.create({
    tenantId,
    userId,
    jti,
    tokenHash: hashToken(refreshToken),
    family,
    expiresAt: new Date(Date.now() + ttlToMs(env.JWT_REFRESH_TTL)),
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return { accessToken, refreshToken };
}

export type AuthUser = AuthTokens['user'];

/**
 * The signed-in user as the SERVER currently sees them.
 *
 * Exists because the login response was the app's only source of `role`
 * and `permissions`, cached on the device from then on. Nothing could ever
 * correct that snapshot: a member promoted to MASTER_ADMIN — or granted a
 * permission — kept the old capabilities in their UI until they happened to
 * sign out and back in, with no indication anything was stale. The client
 * re-reads this on every launch.
 *
 * Reads the user fresh rather than trusting the JWT's claims: the token
 * carries a role from whenever it was issued, which is exactly the stale
 * value this endpoint exists to replace.
 */
export async function getCurrentUser(userId: string, tenantId: string): Promise<AuthUser> {
  const user = await User.findOne({ _id: userId, tenantId });
  if (!user) {
    throw ApiError.unauthorized('USER_NOT_FOUND', 'This account no longer exists.');
  }
  return {
    id: String(user._id),
    tenantId: String(user.tenantId),
    email: user.email,
    role: user.role as 'MASTER_ADMIN' | 'SUB_USER',
    permissions: (user.permissions ?? []) as Permission[],
    displayName: user.displayName ?? undefined,
    avatarUpdatedAt: user.avatarUpdatedAt ? user.avatarUpdatedAt.toISOString() : undefined,
  };
}

export async function login(email: string, password: string, meta: RequestMeta): Promise<AuthTokens> {
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  // Constant-shape response whether the email doesn't exist or the password
  // is wrong — never reveal which one it was.
  if (!user) {
    throw ApiError.unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const passwordOk = await verifyPassword(user.passwordHash, password);
  if (!passwordOk) {
    throw ApiError.unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');
  }

  if (user.status === 'DISABLED') {
    throw ApiError.forbidden('ACCOUNT_DISABLED', 'This account has been disabled');
  }

  const subscriptionStatus = computeSubscriptionStatus(user.validFrom, user.validUntil, user.status);
  if (subscriptionStatus === 'EXPIRED') {
    throw ApiError.forbidden('SUBSCRIPTION_EXPIRED', 'Subscription/validity window has expired');
  }

  const family = randomUUID();
  const { accessToken, refreshToken } = await issueTokenPair(
    String(user._id),
    String(user.tenantId),
    user.role as 'MASTER_ADMIN' | 'SUB_USER',
    family,
    meta,
  );

  user.lastLoginAt = new Date();
  await user.save();

  await recordAudit({
    tenantId: user.tenantId,
    actorUserId: user._id,
    action: 'auth.login',
    targetType: 'User',
    targetId: user._id,
    ip: meta.ip,
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: String(user._id),
      tenantId: String(user.tenantId),
      email: user.email,
      role: user.role as 'MASTER_ADMIN' | 'SUB_USER',
      permissions: (user.permissions ?? []) as Permission[],
      displayName: user.displayName ?? undefined,
      avatarUpdatedAt: user.avatarUpdatedAt ? user.avatarUpdatedAt.toISOString() : undefined,
    },
  };
}

export async function refresh(refreshTokenRaw: string, meta: RequestMeta): Promise<AuthTokens> {
  let claims;
  try {
    claims = verifyRefreshToken(refreshTokenRaw);
  } catch {
    throw ApiError.unauthorized('INVALID_TOKEN', 'Refresh token is invalid or expired');
  }

  const record = await RefreshToken.findOne({ jti: claims.jti });
  if (!record || record.tokenHash !== hashToken(refreshTokenRaw)) {
    throw ApiError.unauthorized('INVALID_TOKEN', 'Refresh token is invalid or expired');
  }

  if (record.revokedAt) {
    // Reuse of an already-rotated token: possible theft. Revoke the whole
    // family so every device sharing this session lineage is signed out.
    await RefreshToken.updateMany(
      { family: record.family, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    await recordAudit({
      tenantId: record.tenantId,
      actorUserId: record.userId,
      action: 'auth.refresh_token_reuse_detected',
      ip: meta.ip,
    });
    throw ApiError.unauthorized('TOKEN_REUSE_DETECTED', 'Session invalidated — please log in again');
  }

  if (record.expiresAt.getTime() < Date.now()) {
    throw ApiError.unauthorized('INVALID_TOKEN', 'Refresh token is invalid or expired');
  }

  const user = await User.findOne({ _id: record.userId, tenantId: record.tenantId });
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

  const { accessToken, refreshToken: newRefreshToken } = await issueTokenPair(
    String(user._id),
    String(user.tenantId),
    user.role as 'MASTER_ADMIN' | 'SUB_USER',
    record.family,
    meta,
  );

  record.revokedAt = new Date();
  await record.save();
  await RefreshToken.updateOne({ jti: record.jti }, { $set: { replacedByJti: claims.jti } });

  return {
    accessToken,
    refreshToken: newRefreshToken,
    user: {
      id: String(user._id),
      tenantId: String(user.tenantId),
      email: user.email,
      role: user.role as 'MASTER_ADMIN' | 'SUB_USER',
      permissions: (user.permissions ?? []) as Permission[],
      displayName: user.displayName ?? undefined,
      avatarUpdatedAt: user.avatarUpdatedAt ? user.avatarUpdatedAt.toISOString() : undefined,
    },
  };
}

export async function logout(refreshTokenRaw: string): Promise<void> {
  let claims;
  try {
    claims = verifyRefreshToken(refreshTokenRaw);
  } catch {
    return; // Already invalid/expired — logout is idempotent, nothing to do.
  }
  const record = await RefreshToken.findOne({ jti: claims.jti });
  if (record && !record.revokedAt) {
    record.revokedAt = new Date();
    await record.save();
    await recordAudit({ tenantId: record.tenantId, actorUserId: record.userId, action: 'auth.logout' });
  }
}

export async function changePassword(
  userId: string,
  tenantId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await User.findOne({ _id: userId, tenantId }).select('+passwordHash');
  if (!user) {
    throw ApiError.notFound('USER_NOT_FOUND', 'User not found');
  }
  const ok = await verifyPassword(user.passwordHash, currentPassword);
  if (!ok) {
    throw ApiError.unauthorized('INVALID_CREDENTIALS', 'Current password is incorrect');
  }
  user.passwordHash = await hashPassword(newPassword);
  await user.save();

  // Revoke every outstanding refresh token for this user — a password
  // change should end every other session.
  await RefreshToken.updateMany(
    { userId, tenantId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

  await recordAudit({ tenantId, actorUserId: userId, action: 'auth.change_password' });
}
