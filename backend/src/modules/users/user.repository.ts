import { Types } from 'mongoose';
import { User, type UserDoc, type UserRole, type UserStatus } from './user.model';
import type { Permission } from './permission';

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
  return User.findOneAndUpdate({ _id: id, tenantId }, { $set: patch }, { new: true });
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
  data: Buffer,
  contentType: string,
): Promise<UserDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return User.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: { avatarData: data, avatarContentType: contentType, avatarUpdatedAt: new Date() } },
    { new: true },
  );
}

export interface AvatarBytes {
  data: Buffer;
  contentType: string;
}

export async function findUserAvatarByIdAndTenant(id: string, tenantId: string): Promise<AvatarBytes | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  const user = await User.findOne({ _id: id, tenantId }).select('+avatarData +avatarContentType');
  if (!user || !user.avatarData || !user.avatarContentType) return null;
  return { data: user.avatarData as unknown as Buffer, contentType: user.avatarContentType };
}
