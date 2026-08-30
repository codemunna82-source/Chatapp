import { ApiError } from '../../lib/ApiError';
import { visibleWhatsAppPhoneNumberId } from './conversation.access';
import type { AuthContext } from '../../types/express';
import { recordAudit } from '../audit/auditLog.service';
import * as repo from './conversation.repository';
import * as contactRepo from '../contacts/contact.repository';
import { findFirstPhoneNumberForTenant, findPhoneNumberByIdAndTenant } from '../whatsapp/whatsapp.repository';
import { findAssignedPhoneNumberId } from '../users/user.repository';
import { deleteMessagesByConversation } from '../messages/message.repository';
import { toPublicContact, type PublicContact } from '../contacts/contact.service';
import type { ConversationLean, ConversationStatus } from './conversation.model';
import type { ContactLean } from '../contacts/contact.model';

export interface PublicConversation {
  id: string;
  tenantId: string;
  contactId: string;
  contact?: PublicContact;
  whatsappPhoneNumberId: string;
  lastMessageAt?: Date;
  lastMessagePreview?: string;
  /** Who sent the last message, and — for our own sends — how far it got.
   *  Lets the chat list render a tick without a query per row. */
  lastMessageDirection?: 'IN' | 'OUT';
  lastMessageStatus?: string;
  lastCustomerMessageAt?: Date;
  conversationWindowExpiresAt?: Date;
  withinCustomerServiceWindow: boolean;
  /**
   * True when this chat is with a seeded demo contact. The client uses it
   * to drop the 24-hour window UI entirely — see contact.model.ts for why
   * that window is meaningless on demo data.
   */
  isDemo: boolean;
  unreadCount: number;
  manuallyUnread: boolean;
  pinned: boolean;
  pinnedAt?: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

function toPublicConversation(doc: ConversationLean, contact?: ContactLean): PublicConversation {
  return {
    id: String(doc._id),
    tenantId: String(doc.tenantId),
    contactId: String(doc.contactId),
    contact: contact ? toPublicContact(contact) : undefined,
    whatsappPhoneNumberId: String(doc.whatsappPhoneNumberId),
    lastMessageAt: doc.lastMessageAt ?? undefined,
    lastMessagePreview: doc.lastMessagePreview ?? undefined,
    lastMessageDirection: (doc.lastMessageDirection as 'IN' | 'OUT' | null) ?? undefined,
    lastMessageStatus: doc.lastMessageStatus ?? undefined,
    lastCustomerMessageAt: doc.lastCustomerMessageAt ?? undefined,
    conversationWindowExpiresAt: doc.conversationWindowExpiresAt ?? undefined,
    withinCustomerServiceWindow: repo.isWithinCustomerServiceWindow(doc),
    // Absent contact (a conversation listed before its contact loads)
    // defaults to NOT demo — the safe direction, since it keeps the real
    // window rules on anything we cannot positively identify as sample data.
    isDemo: contact?.isDemo ?? false,
    // These four carry schema defaults, and this list is read with
    // .lean() — which returns the document exactly as stored and does NOT
    // apply defaults the way a hydrated document does. A conversation
    // written before one of these fields existed (manuallyUnread is newer
    // than the collection) would otherwise come back undefined here rather
    // than as its default.
    unreadCount: doc.unreadCount ?? 0,
    manuallyUnread: doc.manuallyUnread ?? false,
    pinned: doc.pinned ?? false,
    pinnedAt: doc.pinnedAt ?? undefined,
    status: doc.status ?? 'OPEN',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** Batch-fetches contacts for a page of conversations — one query, not N. */
async function enrichWithContacts(tenantId: string, conversations: ConversationLean[]): Promise<PublicConversation[]> {
  const contactIds = [...new Set(conversations.map((c) => String(c.contactId)))];
  const contacts = await contactRepo.findContactsByIdsAndTenant(contactIds, tenantId);
  const byId = new Map(contacts.map((c) => [String(c._id), c]));
  return conversations.map((c) => toPublicConversation(c, byId.get(String(c.contactId))));
}

export interface ListConversationsQuery {
  search?: string;
  cursor?: string;
  limit?: number;
  pinnedOnly?: boolean;
  status?: ConversationStatus;
}

export async function listConversationsForTenant(auth: AuthContext, query: ListConversationsQuery) {
  const tenantId = auth.tenantId;
  let contactIds: string[] | undefined;
  if (query.search) {
    // Two-step: resolve matching contacts first, then filter conversations
    // by contactId — avoids a cross-collection $lookup for a query pattern
    // that's cheap this way given a tenant's contact list size.
    const matches = await contactRepo.listContactsByTenant(tenantId, { search: query.search, limit: 200 });
    contactIds = matches.items.map((c) => String(c._id));
    if (contactIds.length === 0) {
      return { items: [], nextCursor: null };
    }
  }

  const { items, nextCursor } = await repo.listConversationsByTenant(tenantId, {
    cursor: query.cursor,
    limit: query.limit,
    pinnedOnly: query.pinnedOnly,
    status: query.status,
    contactIds,
    whatsappPhoneNumberId: visibleWhatsAppPhoneNumberId(auth),
  });

  return { items: await enrichWithContacts(tenantId, items), nextCursor };
}

/**
 * Loads a conversation the caller is actually allowed to touch.
 *
 * Not visible is reported as 404, not 403: telling a user that a chat
 * exists but belongs to a colleague leaks both its existence and its id,
 * and there is nothing they can do with that knowledge anyway.
 */
async function loadVisibleConversation(auth: AuthContext, id: string) {
  const conversation = await repo.findConversationByIdAndTenant(id, auth.tenantId);
  const scope = visibleWhatsAppPhoneNumberId(auth);
  if (!conversation || (scope && String(conversation.whatsappPhoneNumberId) !== scope)) {
    throw ApiError.notFound('CONVERSATION_NOT_FOUND', 'Conversation not found');
  }
  return conversation;
}

export async function getConversationForTenant(auth: AuthContext, id: string): Promise<PublicConversation> {
  const tenantId = auth.tenantId;
  const conversation = await loadVisibleConversation(auth, id);
  const contact = await contactRepo.findContactByIdAndTenant(String(conversation.contactId), tenantId);
  return toPublicConversation(conversation, contact ?? undefined);
}

export interface UpdateConversationBody {
  pinned?: boolean;
  status?: ConversationStatus;
  manuallyUnread?: true;
}

/**
 * The WhatsApp number a new chat should be sent from.
 *
 * The user's own assignment first (set by a MASTER_ADMIN — see
 * user.model.ts), then the tenant's first number for anyone unassigned,
 * which is what every user did before assignments existed.
 *
 * The assigned id is re-checked against the tenant here rather than
 * trusted: it was validated when written, but the number may have been
 * removed from the workspace since, and a conversation pinned to a number
 * that no longer exists would fail on every send instead of falling back.
 */
async function resolveSendingPhoneNumberId(tenantId: string, actorUserId: string): Promise<string | null> {
  const assignedId = await findAssignedPhoneNumberId(actorUserId, tenantId);
  if (assignedId) {
    const assigned = await findPhoneNumberByIdAndTenant(assignedId, tenantId);
    if (assigned) return String(assigned._id);
  }
  const fallback = await findFirstPhoneNumberForTenant(tenantId);
  return fallback ? String(fallback._id) : null;
}

/**
 * Opens the conversation with a contact, creating it if this is the first
 * time — the app's "new chat" entry point. Idempotent by design: the repo's
 * findOrCreate keys on (tenant, contact), so tapping the same contact twice
 * returns the same thread rather than a duplicate.
 *
 * The conversation is attached to a WhatsApp number at creation, since an
 * outbound-initiated chat has no inbound webhook to say which one it
 * belongs to. Note the idempotency cuts both ways: an existing conversation
 * keeps the number it was created with, so reassigning a user does not move
 * their open chats — deliberate, since the customer's own thread is with
 * that number and moving it mid-conversation would look like a stranger
 * taking over.
 */
export async function startConversationForTenant(
  auth: AuthContext,
  contactId: string,
): Promise<PublicConversation> {
  const tenantId = auth.tenantId;
  const actorUserId = auth.userId;
  const contact = await contactRepo.findContactByIdAndTenant(contactId, tenantId);
  if (!contact) {
    throw ApiError.notFound('CONTACT_NOT_FOUND', 'That contact does not exist.');
  }

  const phoneNumberId = await resolveSendingPhoneNumberId(tenantId, actorUserId);
  if (!phoneNumberId) {
    throw ApiError.badRequest(
      'NO_WHATSAPP_NUMBER',
      'This workspace has no connected WhatsApp number yet, so a chat cannot be started.',
    );
  }

  const conversation = await repo.findOrCreateConversation(tenantId, contactId, phoneNumberId);

  // findOrCreate is keyed on (tenant, contact), so an existing chat comes
  // back on whatever number it was created with — possibly a colleague's.
  // Without this check, "start a chat" would be a way to open one you are
  // not allowed to see.
  const scope = visibleWhatsAppPhoneNumberId(auth);
  if (scope && String(conversation.whatsappPhoneNumberId) !== scope) {
    throw ApiError.forbidden(
      'CONVERSATION_OWNED_BY_ANOTHER_NUMBER',
      'This contact already has a chat on a different WhatsApp number.',
    );
  }

  return toPublicConversation(conversation, contact);
}

/**
 * Deletes a chat from this workspace: the conversation and every message in
 * it. Local to VOXO only — Meta's Cloud API cannot recall anything already
 * delivered, so the customer's own WhatsApp thread is untouched.
 */
export async function deleteConversationForTenant(auth: AuthContext, id: string): Promise<void> {
  const tenantId = auth.tenantId;
  const actorId = auth.userId;
  await loadVisibleConversation(auth, id);
  await deleteMessagesByConversation(tenantId, id);
  await repo.deleteConversation(id, tenantId);
  await recordAudit({
    tenantId,
    actorUserId: actorId,
    action: 'CONVERSATION_DELETED',
    targetType: 'Conversation',
    targetId: id,
  });
}

export type BulkConversationAction = 'archive' | 'unarchive' | 'delete' | 'read';

export interface BulkConversationResult {
  action: BulkConversationAction;
  /** How many of the requested ids actually belonged to this tenant and
   *  changed. Deliberately reported back rather than assumed: ids the
   *  caller no longer owns are silently skipped, and the client should be
   *  able to say "18 of 20" instead of claiming all twenty. */
  affected: number;
}

/**
 * Applies one action to a hand-selected set of chats.
 *
 * A single query per action rather than N round trips from the client:
 * twenty chats archive together instead of half-applying if the connection
 * drops midway, and the audit log gets one entry describing the actual
 * operation instead of twenty unrelated-looking ones.
 *
 * Every query is scoped by tenantId, so an id belonging to another
 * workspace matches nothing — it is skipped, not rejected, because a
 * partial selection going stale mid-gesture is normal and failing the whole
 * batch over it would be worse than doing the rest.
 */
export async function bulkUpdateConversationsForTenant(
  auth: AuthContext,
  ids: string[],
  action: BulkConversationAction,
): Promise<BulkConversationResult> {
  const tenantId = auth.tenantId;
  const actorUserId = auth.userId;
  const scope = visibleWhatsAppPhoneNumberId(auth);
  let affected = 0;

  // Ids the caller cannot see are dropped before any write. Same silent-skip
  // policy as ids from another tenant: a stale multi-select is normal, and
  // failing the whole batch over one id would be worse than doing the rest.
  const permitted = scope ? await repo.filterConversationIdsByPhoneNumber(ids, tenantId, scope) : ids;

  if (action === 'delete') {
    const deletedIds = await repo.deleteConversationsByIds(permitted, tenantId);
    // Messages are cascaded for exactly the ids that were really deleted —
    // deleteConversationsByIds returns those, so nothing belonging to
    // another tenant can be reached through this.
    for (const id of deletedIds) {
      await deleteMessagesByConversation(tenantId, id);
    }
    affected = deletedIds.length;
  } else if (action === 'read') {
    affected = await repo.markConversationsRead(permitted, tenantId);
  } else {
    affected = await repo.setStatusForConversations(permitted, tenantId, action === 'archive' ? 'ARCHIVED' : 'OPEN', scope);
  }

  await recordAudit({
    tenantId,
    actorUserId,
    action: `conversation.bulk.${action}`,
    targetType: 'Conversation',
    metadata: { requested: ids.length, affected },
  });

  return { action, affected };
}

export async function updateConversationForTenant(
  auth: AuthContext,
  id: string,
  patch: UpdateConversationBody,
): Promise<PublicConversation> {
  const tenantId = auth.tenantId;
  const actorUserId = auth.userId;
  let conversation = await loadVisibleConversation(auth, id);

  if (patch.pinned !== undefined) {
    conversation = (await repo.setConversationPinned(id, tenantId, patch.pinned)) ?? conversation;
  }
  if (patch.status !== undefined) {
    conversation = (await repo.setConversationStatus(id, tenantId, patch.status)) ?? conversation;
  }
  if (patch.manuallyUnread) {
    conversation = (await repo.markConversationUnread(id, tenantId)) ?? conversation;
  }

  await recordAudit({
    tenantId,
    actorUserId,
    action: 'conversation.update',
    targetType: 'Conversation',
    targetId: conversation._id,
    metadata: patch as Record<string, unknown>,
  });

  const contact = await contactRepo.findContactByIdAndTenant(String(conversation.contactId), tenantId);
  return toPublicConversation(conversation, contact ?? undefined);
}
