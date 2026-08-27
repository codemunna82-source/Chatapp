import { ApiError } from '../../lib/ApiError';
import { hashPassword } from '../../lib/password';
import { recordAudit } from '../audit/auditLog.service';
import * as repo from './user.repository';
import type { UserDoc } from './user.model';
import type { z } from 'zod';
import type { createUserSchema, updateUserSchema, listUsersQuerySchema } from './user.validation';

export interface PublicUser {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  permissions: string[];
  status: string;
  validFrom: Date;
  validUntil: Date;
  displayName?: string;
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
    role: user.role,
    permissions: user.permissions ?? [],
    status: user.status,
    validFrom: user.validFrom,
    validUntil: user.validUntil,
    displayName: user.displayName ?? undefined,
    lastLoginAt: user.lastLoginAt ?? undefined,
    avatarUpdatedAt: user.avatarUpdatedAt ?? undefined,
    createdAt: user.get('createdAt'),
    updatedAt: user.get('updatedAt'),
  };
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

  const passwordHash = await hashPassword(body.password);
  const user = await repo.createUser({
    tenantId,
    email: body.email,
    passwordHash,
    role: body.role,
    permissions: body.permissions,
    validFrom: body.validFrom,
    validUntil: body.validUntil,
    displayName: body.displayName,
  });

  await recordAudit({
    tenantId,
    actorUserId,
    action: 'user.create',
    targetType: 'User',
    targetId: user._id,
    metadata: { email: user.email, role: user.role },
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
  const user = await repo.updateUserByIdAndTenant(id, tenantId, patch);
  if (!user) {
    throw ApiError.notFound('USER_NOT_FOUND', 'User not found');
  }
  await recordAudit({
    tenantId,
    actorUserId,
    action: 'user.update',
    targetType: 'User',
    targetId: user._id,
    metadata: patch,
  });
  return toPublicUser(user);
}

// Small ceiling, deliberately — the image is stored inline on the User
// document (see user.model.ts avatarData), not in an external bucket,
// so this keeps every profile photo well within a reasonable document
// size instead of needing a resize/compress pipeline server-side.
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

  const user = await repo.setUserAvatar(userId, tenantId, data, contentType);
  if (!user) {
    throw ApiError.notFound('USER_NOT_FOUND', 'User not found');
  }
  return toPublicUser(user);
}

export async function getUserAvatarForTenant(
  tenantId: string,
  id: string,
): Promise<{ data: Buffer; contentType: string }> {
  const avatar = await repo.findUserAvatarByIdAndTenant(id, tenantId);
  if (!avatar) {
    throw ApiError.notFound('AVATAR_NOT_FOUND', 'No profile picture set');
  }
  return avatar;
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
