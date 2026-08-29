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
  whatsappPhoneNumberId?: string;
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
    whatsappPhoneNumberId: input.whatsappPhoneNumberId,
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
  /** `null` clears the assignment; omitted leaves it untouched. */
  whatsappPhoneNumberId?: string | null;
}

/**
 * Turns a patch into a Mongo update document.
 *
 * Exists as its own function — rather than inline in the update below —
 * because of one asymmetry that is easy to get wrong: a null
 * whatsappPhoneNumberId means "unassign" and has to become an `$unset`.
 * `$set`-ting null would leave the field present and holding null, so
 * every read path would then have to treat null and absent as the same
 * thing. Exported for its unit test; nothing else should call it.
 */
export function buildUserUpdate(patch: UpdateUserPatch): Record<string, unknown> {
  const { whatsappPhoneNumberId, ...rest } = patch;
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    // An explicitly-undefined key is "not editing this field", not "clear
    // it" — $set-ting undefined is a Mongo error, not a no-op.
    if (value !== undefined) set[key] = value;
  }
  const unset: Record<string, ''> = {};
  if (whatsappPhoneNumberId === null) unset.whatsappPhoneNumberId = '';
  else if (whatsappPhoneNumberId !== undefined) set.whatsappPhoneNumberId = whatsappPhoneNumberId;

  const update: Record<string, unknown> = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  return update;
}

export async function updateUserByIdAndTenant(
  id: string,
  tenantId: string,
  patch: UpdateUserPatch,
): Promise<UserDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;

  const updated = await User.findOneAndUpdate({ _id: id, tenantId }, buildUserUpdate(patch), { new: true });

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

/**
 * The WhatsApp number this user was assigned, if any. Read on the
 * conversation-start path, so it is deliberately a projection rather than a
 * whole document.
 */
export async function findAssignedPhoneNumberId(userId: string, tenantId: string): Promise<string | null> {
  if (!Types.ObjectId.isValid(userId)) return null;
  const user = await User.findOne({ _id: userId, tenantId }).select('whatsappPhoneNumberId').lean();
  return user?.whatsappPhoneNumberId ? String(user.whatsappPhoneNumberId) : null;
}
