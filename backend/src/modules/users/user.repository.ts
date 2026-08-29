import { Types } from 'mongoose';
import { User, type UserDoc, type UserRole, type UserStatus } from './user.model';
import type { Permission } from './permission';
import { invalidateAuthContext } from '../auth/authContext.service';

/**
 * Every method here takes tenantId explicitly and folds it into the Mongo
 * filter — never `User.findById(id)` alone (spec §13). This is the pattern
 * every other tenant-owned repository in later phases must follow.
 */

export interface CreateUserInput {
  tenantId: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  permissions?: Permission[];
  validFrom: Date;
  validUntil: Date;
  displayName?: string;
}

export async function createUser(input: CreateUserInput): Promise<UserDoc> {
  return User.create({
    tenantId: input.tenantId,
    email: input.email.toLowerCase(),
    passwordHash: input.passwordHash,
    role: input.role,
    permissions: input.permissions ?? [],
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    displayName: input.displayName,
    status: 'ACTIVE',
  });
}

export async function findUserByIdAndTenant(id: string, tenantId: string): Promise<UserDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return User.findOne({ _id: id, tenantId });
}

export interface ListUsersOptions {
  status?: UserStatus;
  cursor?: string; // opaque cursor = _id of the last item seen
  limit?: number;
}

export async function listUsersByTenant(
  tenantId: string,
  opts: ListUsersOptions = {},
): Promise<{ items: UserDoc[]; nextCursor: string | null }> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const filter: Record<string, unknown> = { tenantId };
  if (opts.status) filter.status = opts.status;
  if (opts.cursor && Types.ObjectId.isValid(opts.cursor)) {
    filter._id = { $lt: new Types.ObjectId(opts.cursor) };
  }

  const items = await User.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1);

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? String(page[page.length - 1]!._id) : null;
  return { items: page, nextCursor };
}

export interface UpdateUserPatch {
  role?: UserRole;
  permissions?: Permission[];
  validFrom?: Date;
  validUntil?: Date;
  status?: UserStatus;
  displayName?: string;
}

export async function updateUserByIdAndTenant(
  id: string,
  tenantId: string,
  patch: UpdateUserPatch,
): Promise<UserDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  const updated = await User.findOneAndUpdate({ _id: id, tenantId }, { $set: patch }, { new: true });

  // Every field this patch can carry — status, role, permissions, the
  // validity window — is one the request-time auth check reads. Dropping
  // the cached context here is what makes disabling a user, or narrowing
  // their permissions, take effect on their very next request rather than
  // whenever the entry happened to expire.
  //
  // Unconditional: cheap, and a cache left holding stale authority after a
  // failed conditional is a security bug, not a performance one.
  invalidateAuthContext(id, tenantId);
  return updated;
}

/** Soft-disable — never hard-delete a user, to preserve audit/message history integrity. */
export async function disableUserByIdAndTenant(id: string, tenantId: string): Promise<UserDoc | null> {
  return updateUserByIdAndTenant(id, tenantId, { status: 'DISABLED' });
}

export async function countUsersByTenantAndEmail(email: string): Promise<number> {
  // Email is globally unique (see user.model.ts) — used for pre-flight
  // conflict checks before hitting the unique index.
  return User.countDocuments({ email: email.toLowerCase() });
}

export async function setUserAvatar(
  id: string,
  tenantId: string,
  avatarUrl: string,
  contentType: string,
  cloudinaryPublicId: string,
): Promise<UserDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return User.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: { avatarUrl, avatarContentType: contentType, avatarCloudinaryPublicId: cloudinaryPublicId, avatarUpdatedAt: new Date() } },
    { new: true },
  );
}

export interface AvatarRef {
  url: string;
  contentType: string;
  cloudinaryPublicId?: string;
}

export async function findUserAvatarRefByIdAndTenant(id: string, tenantId: string): Promise<AvatarRef | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  const user = await User.findOne({ _id: id, tenantId }).select('+avatarUrl +avatarContentType +avatarCloudinaryPublicId');
  if (!user || !user.avatarUrl || !user.avatarContentType) return null;
  return { url: user.avatarUrl, contentType: user.avatarContentType, cloudinaryPublicId: user.avatarCloudinaryPublicId ?? undefined };
}
