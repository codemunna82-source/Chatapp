import { randomUUID, createHash } from 'node:crypto';
import { User, computeSubscriptionStatus } from '../users/user.model';
import { findUserByPhone } from '../users/user.repository';
import { normalizePhone } from '../../lib/phone';
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
    /** What this person signs in with. Absent on accounts created before phone sign-in existed. */
    phone?: string;
    role: 'MASTER_ADMIN' | 'SUB_USER';
    permissions: Permission[];
    displayName?: string;
    avatarUpdatedAt?: string;
    /**
     * The number an admin assigned this user, if any. Sent with the
     * session because the app decides from it whether to offer "Connect
     * WhatsApp" at all — a member whose number was chosen for them must
     * not be able to run Embedded Signup and replace that choice with
     * their own.
     */
    whatsappPhoneNumberId?: string;
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
    phone: user.phone ?? undefined,
    role: user.role as 'MASTER_ADMIN' | 'SUB_USER',
    permissions: (user.permissions ?? []) as Permission[],
    displayName: user.displayName ?? undefined,
    avatarUpdatedAt: user.avatarUpdatedAt ? user.avatarUpdatedAt.toISOString() : undefined,
    // Must match the login payload exactly. AuthUser is derived from
    // AuthTokens['user'], so an omission here is not a type error — it
    // just means the field silently disappears from the store the first
    // time a restored session calls /auth/me.
    whatsappPhoneNumberId: user.whatsappPhoneNumberId ? String(user.whatsappPhoneNumberId) : undefined,
  };
}

/**
 * Signing in with a phone number, or an email.
 *
 * Which one it is comes from the value, not from a second field the person
 * has to choose: normalizePhone accepts "+91 98765-43210", "0091…" and the
 * bare digits and returns one canonical form, and returns null for
 * anything with an @ in it. So a number is looked up as a number and
 * everything else as an email, with nothing to get wrong at the keyboard.
 *
 * Email still works, and that is load-bearing rather than legacy. Phone
 * was added after accounts existed, so every account that predates it has
 * no number — including the MASTER_ADMIN, who is the only person who can
 * set the missing ones. Phone-only sign-in would have locked that person
 * out of the workspace they administer, with the fix on the other side of
 * the door.
 */
export async function login(identifier: string, password: string, meta: RequestMeta): Promise<AuthTokens> {
  const asPhone = normalizePhone(identifier);
  const user = asPhone
    ? await findUserByPhone(asPhone)
    : await User.findOne({ email: identifier.trim().toLowerCase() }).select('+passwordHash');

  // Constant-shape response whether the account doesn't exist or the
  // password is wrong — never reveal which one it was.
  if (!user) {
    throw ApiError.unauthorized('INVALID_CREDENTIALS', 'Invalid phone number or password');
  }

  const passwordOk = await verifyPassword(user.passwordHash, password);
  if (!passwordOk) {
    throw ApiError.unauthorized('INVALID_CREDENTIALS', 'Invalid phone number or password');
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
      phone: user.phone ?? undefined,
      role: user.role as 'MASTER_ADMIN' | 'SUB_USER',
      permissions: (user.permissions ?? []) as Permission[],
      displayName: user.displayName ?? undefined,
      avatarUpdatedAt: user.avatarUpdatedAt ? user.avatarUpdatedAt.toISOString() : undefined,
      whatsappPhoneNumberId: user.whatsappPhoneNumberId ? String(user.whatsappPhoneNumberId) : undefined,
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
      phone: user.phone ?? undefined,
      role: user.role as 'MASTER_ADMIN' | 'SUB_USER',
      permissions: (user.permissions ?? []) as Permission[],
      displayName: user.displayName ?? undefined,
      avatarUpdatedAt: user.avatarUpdatedAt ? user.avatarUpdatedAt.toISOString() : undefined,
      whatsappPhoneNumberId: user.whatsappPhoneNumberId ? String(user.whatsappPhoneNumberId) : undefined,
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

  // A password change should end every other session.
  await revokeAllSessionsForUser(userId, tenantId);

  await recordAudit({ tenantId, actorUserId: userId, action: 'auth.change_password' });
}

/**
 * Ends every session this user currently holds.
 *
 * Pulled out of changePassword so the admin-driven reset in
 * user.service.ts can call the same thing. A password that changes while
 * the old refresh tokens keep working is not a password change from the
 * point of view of whoever still holds one — which is precisely the
 * person an admin reset is usually aimed at.
 *
 * Access tokens already issued still work until they expire; the refresh
 * chain is what stops the session being renewed past that.
 */
export async function revokeAllSessionsForUser(userId: string, tenantId: string): Promise<void> {
  await RefreshToken.updateMany(
    { userId, tenantId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}
