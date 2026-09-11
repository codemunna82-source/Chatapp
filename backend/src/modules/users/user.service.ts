import { ApiError } from '../../lib/ApiError';
import { normalizePhone } from '../../lib/phone';
import { hashPassword } from '../../lib/password';
import { revokeAllSessionsForUser } from '../auth/auth.service';
import { recordAudit } from '../audit/auditLog.service';
import * as repo from './user.repository';
import { findPhoneNumberByIdAndTenant } from '../whatsapp/whatsapp.repository';
import { isCloudinaryConfigured, uploadBufferToCloudinary, fetchCloudinaryBuffer, deleteCloudinaryAsset } from '../../integrations/cloudinary';
import type { UserDoc } from './user.model';
import type { z } from 'zod';
import type { createUserSchema, updateUserSchema, listUsersQuerySchema } from './user.validation';

export interface PublicUser {
  id: string;
  tenantId: string;
  email: string;
  /** What this person signs in with. Absent on accounts created before it existed. */
  phone?: string;
  role: string;
  permissions: string[];
  status: string;
  validFrom: Date;
  validUntil: Date;
  displayName?: string;
  /** Which of the tenant's WhatsApp numbers this user sends from, if assigned. */
  whatsappPhoneNumberId?: string;
  lastLoginAt?: Date;
  avatarUpdatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function toPublicUser(user: UserDoc): PublicUser {
  return {
    id: String(user._id),
    tenantId: String(user.tenantId),
    email: user.email,
    phone: user.phone ?? undefined,
    role: user.role,
    permissions: user.permissions ?? [],
    status: user.status,
    validFrom: user.validFrom,
    validUntil: user.validUntil,
    displayName: user.displayName ?? undefined,
    whatsappPhoneNumberId: user.whatsappPhoneNumberId ? String(user.whatsappPhoneNumberId) : undefined,
    lastLoginAt: user.lastLoginAt ?? undefined,
    avatarUpdatedAt: user.avatarUpdatedAt ?? undefined,
    createdAt: user.get('createdAt'),
    updatedAt: user.get('updatedAt'),
  };
}

/**
 * Refuses a WhatsApp number that is not this tenant's.
 *
 * The id arrives in a request body, so it is attacker-controlled even
 * behind the MASTER_ADMIN guard — an admin of tenant A must not be able to
 * point one of their users at tenant B's number and send through it. The
 * tenantId in the lookup filter is the whole check; without it this field
 * would be a cross-tenant send primitive.
 */
async function assertPhoneNumberBelongsToTenant(tenantId: string, phoneNumberId: string): Promise<void> {
  const phoneNumber = await findPhoneNumberByIdAndTenant(phoneNumberId, tenantId);
  if (!phoneNumber) {
    throw ApiError.badRequest(
      'WHATSAPP_NUMBER_NOT_FOUND',
      'That WhatsApp number does not belong to this workspace.',
    );
  }
}

type CreateUserBody = z.infer<typeof createUserSchema>;
type UpdateUserBody = z.infer<typeof updateUserSchema>;
type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export async function createUserForTenant(
  tenantId: string,
  actorUserId: string,
  body: CreateUserBody,
): Promise<PublicUser> {
  if (body.validUntil <= body.validFrom) {
    throw ApiError.badRequest('INVALID_VALIDITY_WINDOW', 'validUntil must be after validFrom');
  }
  const existing = await repo.countUsersByTenantAndEmail(body.email);
  if (existing > 0) {
    throw ApiError.conflict('EMAIL_ALREADY_EXISTS', 'A user with this email already exists');
  }

  // Checked globally, not per tenant, because the phone number IS the
  // sign-in identifier and login has no workspace to scope by. Two
  // workspaces holding the same number would make "who is this" ambiguous
  // at exactly the moment it has to be certain.
  const phone = normalizePhone(body.phone)!;
  if ((await repo.countUsersByPhone(phone)) > 0) {
    throw ApiError.conflict('PHONE_ALREADY_EXISTS', 'A user with this phone number already exists');
  }

  if (body.whatsappPhoneNumberId) {
    await assertPhoneNumberBelongsToTenant(tenantId, body.whatsappPhoneNumberId);
  }

  const passwordHash = await hashPassword(body.password);
  const user = await repo.createUser({
    tenantId,
    email: body.email,
    phone,
    passwordHash,
    role: body.role,
    permissions: body.permissions,
    validFrom: body.validFrom,
    validUntil: body.validUntil,
    displayName: body.displayName,
    whatsappPhoneNumberId: body.whatsappPhoneNumberId,
  });

  await recordAudit({
    tenantId,
    actorUserId,
    action: 'user.create',
    targetType: 'User',
    targetId: user._id,
    metadata: { email: user.email, phone: user.phone, role: user.role },
  });

  return toPublicUser(user);
}

export async function listUsersForTenant(tenantId: string, query: ListUsersQuery) {
  const { items, nextCursor } = await repo.listUsersByTenant(tenantId, query);
  return { items: items.map(toPublicUser), nextCursor };
}

export async function getUserForTenant(tenantId: string, id: string): Promise<PublicUser> {
  const user = await repo.findUserByIdAndTenant(id, tenantId);
  if (!user) {
    throw ApiError.notFound('USER_NOT_FOUND', 'User not found');
  }
  return toPublicUser(user);
}

export async function updateUserForTenant(
  tenantId: string,
  actorUserId: string,
  id: string,
  patch: UpdateUserBody,
): Promise<PublicUser> {
  if (patch.validFrom && patch.validUntil && patch.validUntil <= patch.validFrom) {
    throw ApiError.badRequest('INVALID_VALIDITY_WINDOW', 'validUntil must be after validFrom');
  }
  if (patch.whatsappPhoneNumberId) {
    await assertPhoneNumberBelongsToTenant(tenantId, patch.whatsappPhoneNumberId);
  }

  // Normalised before the uniqueness check and before the write, so the
  // two agree. Checking the typed form and storing the canonical one would
  // let "+91 98765 43210" past a check that only ever compared it against
  // "+919876543210", and the unique index would then reject the save with
  // an error the API has no wording for.
  let normalizedPatch = patch;
  if (patch.phone !== undefined) {
    const phone = normalizePhone(patch.phone)!;
    const holder = await repo.findUserByPhone(phone);
    if (holder && String(holder._id) !== id) {
      throw ApiError.conflict('PHONE_ALREADY_EXISTS', 'A user with this phone number already exists');
    }
    normalizedPatch = { ...patch, phone };
  }

  // Same shape of check as the phone number above, and for the same
  // reason: both are global sign-in identifiers, so a collision has to be
  // reported as a conflict with wording, not left to surface as a raw
  // duplicate-key error from the unique index. Compared against the
  // holder's id so that saving a form without touching the email — which
  // sends the value back unchanged — is not read as a collision with the
  // account's own address.
  if (normalizedPatch.email !== undefined) {
    const holder = await repo.findUserByEmail(normalizedPatch.email);
    if (holder && String(holder._id) !== id) {
      throw ApiError.conflict('EMAIL_ALREADY_EXISTS', 'A user with this email already exists');
    }
  }

  const user = await repo.updateUserByIdAndTenant(id, tenantId, normalizedPatch);
  if (!user) {
    throw ApiError.notFound('USER_NOT_FOUND', 'User not found');
  }
  await recordAudit({
    tenantId,
    actorUserId,
    action: 'user.update',
    targetType: 'User',
    targetId: user._id,
    metadata: normalizedPatch,
  });
  return toPublicUser(user);
}

/**
 * An admin setting a new password for someone who cannot sign in.
 *
 * Separate from changePassword, which demands the current password: the
 * whole reason this exists is the person who has lost theirs. Until it did,
 * a mistyped password at creation time made an account permanently
 * unreachable — there was no edit, no reset, and no recovery.
 *
 * Two things it deliberately does:
 *
 * 1. Revokes every outstanding refresh token for that user. A reset that
 *    left old sessions alive would not actually take access away from
 *    whoever the admin is resetting it away from, which is half the
 *    reason an admin reaches for it.
 * 2. Records the reset in the audit log WITHOUT the password. The generic
 *    update path stores its whole patch in audit metadata; a password
 *    routed through there would sit in plaintext in a collection built to
 *    be read.
 *
 * Resetting your own password here is allowed and signs you out too —
 * that is the honest consequence of step 1, not an oversight.
 */
export async function resetUserPasswordForTenant(
  tenantId: string,
  actorUserId: string,
  id: string,
  password: string,
): Promise<PublicUser> {
  const passwordHash = await hashPassword(password);
  const user = await repo.setUserPasswordHash(id, tenantId, passwordHash);
  if (!user) {
    throw ApiError.notFound('USER_NOT_FOUND', 'User not found');
  }

  await revokeAllSessionsForUser(String(user._id), tenantId);

  await recordAudit({
    tenantId,
    actorUserId,
    action: 'user.reset_password',
    targetType: 'User',
    targetId: user._id,
    metadata: { selfService: String(user._id) === actorUserId },
  });

  return toPublicUser(user);
}

// Small ceiling, deliberately — keeps upload/proxy latency low even though
// the bytes now live in Cloudinary (see integrations/cloudinary.ts) rather
// than inline on the User document.
export const AVATAR_MAX_SIZE_BYTES = 1.5 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export async function updateOwnAvatar(
  tenantId: string,
  userId: string,
  data: Buffer,
  contentType: string,
): Promise<PublicUser> {
  if (!AVATAR_MIME_TYPES.includes(contentType)) {
    throw ApiError.badRequest(
      'UNSUPPORTED_AVATAR_TYPE',
      `Unsupported image type "${contentType}" — use JPEG, PNG, or WebP`,
    );
  }
  if (data.length > AVATAR_MAX_SIZE_BYTES) {
    throw ApiError.badRequest(
      'AVATAR_TOO_LARGE',
      `Image is ${(data.length / (1024 * 1024)).toFixed(1)}MB — must be under ${AVATAR_MAX_SIZE_BYTES / (1024 * 1024)}MB`,
    );
  }
  if (!isCloudinaryConfigured()) {
    throw ApiError.internal(
      'CLOUDINARY_NOT_CONFIGURED',
      'Profile picture storage is not configured on this server (CLOUDINARY_URL is unset)',
    );
  }

  const previous = await repo.findUserAvatarRefByIdAndTenant(userId, tenantId);

  const uploaded = await uploadBufferToCloudinary(data, {
    folder: `voxo/${tenantId}/avatars`,
    resourceType: 'image',
  });

  const user = await repo.setUserAvatar(userId, tenantId, uploaded.url, contentType, uploaded.publicId);
  if (!user) {
    throw ApiError.notFound('USER_NOT_FOUND', 'User not found');
  }

  // Best-effort: drop the previous photo now that the new one is live.
  // Never blocks the response — an orphaned old asset isn't worth failing
  // a successful avatar update over.
  if (previous?.cloudinaryPublicId) {
    void deleteCloudinaryAsset(previous.cloudinaryPublicId, 'image');
  }

  return toPublicUser(user);
}

export async function getUserAvatarForTenant(
  tenantId: string,
  id: string,
): Promise<{ data: Buffer; contentType: string }> {
  const avatar = await repo.findUserAvatarRefByIdAndTenant(id, tenantId);
  if (!avatar) {
    throw ApiError.notFound('AVATAR_NOT_FOUND', 'No profile picture set');
  }
  const data = await fetchCloudinaryBuffer(avatar.url);
  return { data, contentType: avatar.contentType };
}

/** DELETE /api/users/:id is implemented as a soft-disable — see user.repository.ts. */
export async function disableUserForTenant(
  tenantId: string,
  actorUserId: string,
  id: string,
): Promise<PublicUser> {
  const user = await repo.disableUserByIdAndTenant(id, tenantId);
  if (!user) {
    throw ApiError.notFound('USER_NOT_FOUND', 'User not found');
  }
  await recordAudit({ tenantId, actorUserId, action: 'user.disable', targetType: 'User', targetId: user._id });
  return toPublicUser(user);
}
