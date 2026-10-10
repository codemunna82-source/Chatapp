import { ApiError } from '../../lib/ApiError';
import { recordAudit } from '../audit/auditLog.service';
import * as repo from './contact.repository';
import type { ContactLean } from './contact.model';
import { deleteConversationsByContact } from '../conversations/conversation.repository';
import { deleteMessagesByConversation } from '../messages/message.repository';
import { revokeSessionsForConversation } from '../guest/guestSession.repository';
import { deleteGuestPushTokensForConversation } from '../guest/guestPushToken.repository';
import {
  isCloudinaryConfigured,
  uploadBufferToCloudinary,
  fetchCloudinaryBuffer,
  deleteCloudinaryAsset,
} from '../../integrations/cloudinary';
// One set of image rules for "a photo attached to a person", shared with
// the user avatar path rather than duplicated and left to drift.
import { AVATAR_MAX_SIZE_BYTES, AVATAR_MIME_TYPES } from '../users/user.service';

export interface PublicContact {
  id: string;
  tenantId: string;
  phone: string;
  name?: string;
  /**
   * When the contact's photo last changed, or absent if there is none.
   *
   * Replaces a plain `avatarUrl` the API used to accept and nothing ever
   * set or read — the bytes now live in Cloudinary behind an authenticated
   * route, exactly like user avatars, and this doubles as the client's
   * cache-buster.
   */
  avatarUpdatedAt?: Date;
  tags: string[];
  /** Seeded sample data — see contact.model.ts. */
  isDemo: boolean;
  /**
   * An agent flagged this contact — a note to every other agent, not an
   * enforcement mechanism. See contact.model.ts for why there is no real
   * block to fall back on.
   */
  blocked: boolean;
  /** When `blocked` was last set true. Absent when never flagged, or
   *  cleared again — see contact.repository.ts's setContactBlocked. */
  blockedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Takes the lean shape; a hydrated ContactDoc satisfies it too, so create
// and update paths keep passing their own documents straight in.
export function toPublicContact(doc: ContactLean): PublicContact {
  return {
    id: String(doc._id),
    tenantId: String(doc.tenantId),
    phone: doc.phone,
    name: doc.name ?? undefined,
    avatarUpdatedAt: doc.avatarUpdatedAt ?? undefined,
    tags: doc.tags ?? [],
    isDemo: doc.isDemo ?? false,
    blocked: doc.blocked ?? false,
    blockedAt: doc.blockedAt ?? undefined,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export interface CreateContactBody {
  phone: string;
  name?: string;
  tags?: string[];
}

export async function createContactForTenant(
  tenantId: string,
  actorUserId: string,
  body: CreateContactBody,
): Promise<PublicContact> {
  const existing = await repo.findContactByPhoneAndTenant(body.phone, tenantId);
  if (existing) {
    throw ApiError.conflict('CONTACT_ALREADY_EXISTS', 'A contact with this phone number already exists');
  }
  const contact = await repo.createContact({ tenantId, ...body });
  await recordAudit({
    tenantId,
    actorUserId,
    action: 'contact.create',
    targetType: 'Contact',
    targetId: contact._id,
  });
  return toPublicContact(contact);
}

export interface ListContactsQuery {
  search?: string;
  cursor?: string;
  limit?: number;
}

export async function listContactsForTenant(tenantId: string, query: ListContactsQuery) {
  const { items, nextCursor } = await repo.listContactsByTenant(tenantId, query);
  return { items: items.map(toPublicContact), nextCursor };
}

export async function getContactForTenant(tenantId: string, id: string): Promise<PublicContact> {
  const contact = await repo.findContactByIdAndTenant(id, tenantId);
  if (!contact) {
    throw ApiError.notFound('CONTACT_NOT_FOUND', 'Contact not found');
  }
  return toPublicContact(contact);
}

export interface UpdateContactBody {
  name?: string;
  tags?: string[];
}

/**
 * Deletes a contact and everything anchored to them in this workspace: the
 * conversations with that contact and those conversations' messages. Left
 * behind, those would be orphans pointing at a contact that no longer
 * exists, and would still surface in the chat list.
 *
 * Workspace-local, like every other delete here — nothing is withdrawn from
 * the customer's own WhatsApp.
 */
export async function deleteContactForTenant(tenantId: string, id: string, actorId: string): Promise<void> {
  const contact = await repo.findContactByIdAndTenant(id, tenantId);
  if (!contact) {
    throw ApiError.notFound('CONTACT_NOT_FOUND', 'That contact does not exist.');
  }

  const conversationIds = await deleteConversationsByContact(tenantId, id);
  for (const conversationId of conversationIds) {
    await deleteMessagesByConversation(tenantId, conversationId);
    // A live private-chat link left behind here fails every send with a
    // raw not-found instead of the clean "no longer valid" the guest app
    // already shows for a deliberately revoked one — see
    // deleteConversationForTenant for the same fix.
    await revokeSessionsForConversation(conversationId, tenantId);
    await deleteGuestPushTokensForConversation(tenantId, conversationId);
  }
  await repo.deleteContact(id, tenantId);

  await recordAudit({
    tenantId,
    actorUserId: actorId,
    action: 'CONTACT_DELETED',
    targetType: 'Contact',
    targetId: id,
  });
}

export async function updateContactForTenant(
  tenantId: string,
  actorUserId: string,
  id: string,
  patch: UpdateContactBody,
): Promise<PublicContact> {
  const contact = await repo.updateContactByIdAndTenant(id, tenantId, patch);
  if (!contact) {
    throw ApiError.notFound('CONTACT_NOT_FOUND', 'Contact not found');
  }
  await recordAudit({
    tenantId,
    actorUserId,
    action: 'contact.update',
    targetType: 'Contact',
    targetId: contact._id,
    metadata: patch as Record<string, unknown>,
  });
  return toPublicContact(contact);
}

/**
 * Flags or unflags a contact for every agent — see contact.model.ts for
 * why this is a note, not a real block. Idempotent: setting the same
 * state twice still records who most recently did it.
 */
export async function setContactBlockedForTenant(
  tenantId: string,
  actorUserId: string,
  id: string,
  blocked: boolean,
): Promise<PublicContact> {
  const contact = await repo.setContactBlocked(id, tenantId, blocked, actorUserId);
  if (!contact) {
    throw ApiError.notFound('CONTACT_NOT_FOUND', 'Contact not found');
  }
  await recordAudit({
    tenantId,
    actorUserId,
    action: blocked ? 'contact.blocked' : 'contact.unblocked',
    targetType: 'Contact',
    targetId: contact._id,
  });
  return toPublicContact(contact);
}

/**
 * Logs that an agent flagged something about this contact as not right.
 *
 * No destination of its own — unlike a guest's report of the business,
 * there is no safety team on the other end of a business reporting its
 * own customer. This is the audit trail an admin can read later, and
 * nothing more; `blocked` is the part of this that other agents actually
 * see on the contact.
 */
export async function reportContactForTenant(
  tenantId: string,
  actorUserId: string,
  id: string,
  reason?: string,
): Promise<void> {
  const contact = await repo.findContactByIdAndTenant(id, tenantId);
  if (!contact) {
    throw ApiError.notFound('CONTACT_NOT_FOUND', 'Contact not found');
  }
  await recordAudit({
    tenantId,
    actorUserId,
    action: 'contact.reported',
    targetType: 'Contact',
    targetId: contact._id,
    metadata: reason ? { reason } : undefined,
  });
}

/**
 * Uploads a photo for a contact.
 *
 * Deliberately the same shape, limits and storage as the user avatar path
 * (user.service.ts): one set of rules for "an image attached to a person"
 * rather than two that drift. Meta's Cloud API exposes no way to READ a
 * customer's WhatsApp profile picture, so this is the workspace's own
 * record of who someone is, not a sync.
 */
export async function updateContactAvatar(
  tenantId: string,
  contactId: string,
  actorUserId: string,
  data: Buffer,
  contentType: string,
): Promise<PublicContact> {
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
      'Photo storage is not configured on this server (CLOUDINARY_URL is unset)',
    );
  }

  const existing = await repo.findContactByIdAndTenant(contactId, tenantId);
  if (!existing) {
    throw ApiError.notFound('CONTACT_NOT_FOUND', 'Contact not found');
  }

  const previous = await repo.findContactAvatarRefByIdAndTenant(contactId, tenantId);
  const uploaded = await uploadBufferToCloudinary(data, {
    folder: `voxo/${tenantId}/contact-avatars`,
    resourceType: 'image',
  });

  const contact = await repo.setContactAvatar(contactId, tenantId, uploaded.url, contentType, uploaded.publicId);
  if (!contact) {
    throw ApiError.notFound('CONTACT_NOT_FOUND', 'Contact not found');
  }

  // Only after the new one is stored, and never fatally: an orphaned old
  // image costs storage, a failed delete that rolled back the upload would
  // cost the user their photo.
  if (previous?.cloudinaryPublicId) {
    await deleteCloudinaryAsset(previous.cloudinaryPublicId).catch(() => undefined);
  }

  await recordAudit({
    tenantId,
    actorUserId,
    action: 'contact.avatar.updated',
    targetType: 'Contact',
    targetId: contact._id,
  });

  return toPublicContact(contact);
}

export async function getContactAvatarForTenant(
  tenantId: string,
  contactId: string,
): Promise<{ data: Buffer; contentType: string }> {
  const avatar = await repo.findContactAvatarRefByIdAndTenant(contactId, tenantId);
  if (!avatar) {
    throw ApiError.notFound('AVATAR_NOT_FOUND', 'No photo set for this contact');
  }
  const data = await fetchCloudinaryBuffer(avatar.url);
  return { data, contentType: avatar.contentType };
}
