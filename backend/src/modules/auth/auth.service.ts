import { randomUUID, createHash } from 'node:crypto';
import { User, computeSubscriptionStatus } from '../users/user.model';
import { WhatsAppPhoneNumber } from '../whatsapp/whatsappPhoneNumber.model';
import { findUserByPhone } from '../users/user.repository';
import { normalizePhone } from '../../lib/phone';
import { RefreshToken, type RefreshTokenDoc } from './refreshToken.model';
import { invalidateAuthContext } from './authContext.service';
import { isSessionReplaced } from './singleDevice';
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
): Promise<{ accessToken: string; refreshToken: string; jti: string }> {
  const accessToken = signAccessToken({ sub: userId, tenantId, role, family });

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

  // The jti goes back to the caller so a rotation can record WHICH token
  // replaced the old one. It used to be private to this function, and the
  // rotation below wrote the old token's own jti into replacedByJti — a
  // field pointing at itself.
  return { accessToken, refreshToken, jti };
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

  /**
   * The admin's per-number access switch, checked at the door.
   *
   * The auth context already refuses every REQUEST from a member whose
   * number is switched off, so this is not what makes the rule hold. What
   * it fixes is the experience: without it the sign-in SUCCEEDS, the app
   * opens, and the first call behind it is refused — so the member sees
   * the app flash past and land back on the sign-in screen, which reads
   * like a bug rather than a decision someone made.
   *
   * `enabled !== false` for the same reason it is written that way
   * everywhere else: numbers stored before this field existed have no
   * value, and absent has to mean on.
   */
  if (user.whatsappPhoneNumberId) {
    const number = await WhatsAppPhoneNumber.findById(user.whatsappPhoneNumberId)
      .select('enabled')
      .lean();
    if (number && number.enabled === false) {
      throw ApiError.forbidden(
        'NUMBER_ACCESS_DENIED',
        'Your access has been turned off. Please contact your administrator.',
      );
    }
  }

  /**
   * One device at a time: this sign-in takes the account.
   *
   * Every refresh token the account already had is revoked, and the
   * user's active family becomes this one — so the previous device is
   * refused on its very next request (see authContext.service.ts) and
   * cannot refresh its way back in either.
   *
   * BEFORE the new pair is minted, and that order is the whole point.
   * This sweep matches `revokedAt: null`, which in Mongo matches a field
   * that is absent as well as one that is null — so running it after
   * issueTokenPair revoked the token this login had just handed out,
   * about five milliseconds old. Every sign-in produced a refresh token
   * that was already dead: the session worked until the access token
   * expired, then the first refresh presented a revoked token with no
   * replacement, which is precisely the shape of a stolen token being
   * replayed. Reuse detection did its job, revoked the family, and
   * answered TOKEN_REUSE_DETECTED — and the app, correctly, signed the
   * user out. On every device, every time, for as long as an access
   * token lasts.
   *
   * Also before lastLoginAt is saved, so a crash between the two leaves
   * the account signed out rather than signed in twice.
   */
  await RefreshToken.updateMany(
    { userId: user._id, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

  const family = randomUUID();
  const { accessToken, refreshToken } = await issueTokenPair(
    String(user._id),
    String(user.tenantId),
    user.role as 'MASTER_ADMIN' | 'SUB_USER',
    family,
    meta,
  );

  user.activeSessionFamily = family;
  user.lastLoginAt = new Date();
  await user.save();
  // The old device's context is cached for up to ten seconds; drop it so
  // it is refused now rather than at the end of that window.
  invalidateAuthContext(String(user._id), String(user.tenantId));

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

/**
 * How long after a rotation the previous token is still forgiven.
 *
 * Rotation plus reuse detection is the right design and it has one blind
 * spot: two refreshes racing are indistinguishable from a stolen token
 * replayed. The app has more than one JavaScript context — the UI and the
 * headless push handler, which wakes for a call or a message — and each
 * has its own in-flight-refresh guard, so a push landing while the UI
 * refreshes produced two rotations seconds apart. The loser's token was
 * then presented once more, read as theft, and the whole family revoked:
 * the user was signed out for good, with re-login the only way back.
 *
 * Observed in production exactly that way — two refreshes 0.8s apart,
 * both 200, then TOKEN_REUSE_DETECTED on every attempt afterwards.
 *
 * A minute is far longer than any race and far shorter than a useful
 * attack. Real theft shows up as a token replayed long after its
 * rotation, or from another address, and that still revokes the family.
 */
const REFRESH_RACE_GRACE_MS = 60_000;

/**
 * Whether a revoked token is a racing sibling rather than a replay.
 *
 * Both conditions are required. Recently revoked, because a token
 * replayed later is exactly what reuse detection is for; and replaced by
 * a token that is ITSELF still live, because if the replacement has also
 * been revoked the lineage is already in trouble and forgiving this one
 * would paper over it.
 */
function isConcurrentRefresh(record: RefreshTokenDoc): boolean {
  if (!record.revokedAt || !record.replacedByJti) return false;
  return Date.now() - record.revokedAt.getTime() <= REFRESH_RACE_GRACE_MS;
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

  if (record.revokedAt && !isConcurrentRefresh(record)) {
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

  /**
   * A device that has been replaced cannot refresh its way back in.
   *
   * Login revokes the old refresh tokens, so this is belt and braces —
   * but the revocation is a separate write, and a refresh racing it would
   * otherwise mint a fresh pair for a device the account no longer
   * belongs to. Absent activeSessionFamily means nobody has signed in
   * since the field existed, which is treated as "allow".
   */
  if (isSessionReplaced(user.activeSessionFamily, record.family)) {
    throw ApiError.unauthorized(
      'SESSION_REPLACED',
      'Your account was signed in on another device. Sign in again to use it here.',
    );
  }

  const {
    accessToken,
    refreshToken: newRefreshToken,
    jti: newJti,
  } = await issueTokenPair(
    String(user._id),
    String(user.tenantId),
    user.role as 'MASTER_ADMIN' | 'SUB_USER',
    record.family,
    meta,
  );

  // One write, and pointing at the RIGHT token. This was two writes, the
  // second of which set replacedByJti to `claims.jti` — the jti of the
  // token being rotated, which is this record's own. The field meant to
  // say "here is what replaced me" said "here is me", so the lineage
  // could not be followed and isConcurrentRefresh was reading a value
  // that was true of every rotated token regardless.
  await RefreshToken.updateOne(
    { jti: record.jti },
    { $set: { revokedAt: new Date(), replacedByJti: newJti } },
  );

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

/**
 * Exposed for the race test only.
 *
 * The rule it guards is pure and the path it sits on is not: reaching it
 * through refresh() needs a database, two rotations and a clock, which is
 * three things that can fail for reasons other than the rule being wrong.
 */
export const __testing = { isConcurrentRefresh, REFRESH_RACE_GRACE_MS };
