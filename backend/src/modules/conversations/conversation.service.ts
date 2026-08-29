import { ApiError } from '../../lib/ApiError';
import { recordAudit } from '../audit/auditLog.service';
import * as repo from './conversation.repository';
import * as contactRepo from '../contacts/contact.repository';
import { findFirstPhoneNumberForTenant } from '../whatsapp/whatsapp.repository';
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

export async function listConversationsForTenant(tenantId: string, query: ListConversationsQuery) {
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
  });

  return { items: await enrichWithContacts(tenantId, items), nextCursor };
}

export async function getConversationForTenant(tenantId: string, id: string): Promise<PublicConversation> {
  const conversation = await repo.findConversationByIdAndTenant(id, tenantId);
  if (!conversation) {
    throw ApiError.notFound('CONVERSATION_NOT_FOUND', 'Conversation not found');
  }
  const contact = await contactRepo.findContactByIdAndTenant(String(conversation.contactId), tenantId);
  return toPublicConversation(conversation, contact ?? undefined);
}

export interface UpdateConversationBody {
  pinned?: boolean;
  status?: ConversationStatus;
  manuallyUnread?: true;
}

/**
 * Opens the conversation with a contact, creating it if this is the first
 * time — the app's "new chat" entry point. Idempotent by design: the repo's
 * findOrCreate keys on (tenant, contact), so tapping the same contact twice
 * returns the same thread rather than a duplicate.
 *
 * The conversation is attached to the tenant's own WhatsApp number, since an
 * outbound-initiated chat has no inbound webhook to say which number it
 * belongs to.
 */
export async function startConversationForTenant(tenantId: string, contactId: string): Promise<PublicConversation> {
  const contact = await contactRepo.findContactByIdAndTenant(contactId, tenantId);
  if (!contact) {
    throw ApiError.notFound('CONTACT_NOT_FOUND', 'That contact does not exist.');
  }

  const phoneNumber = await findFirstPhoneNumberForTenant(tenantId);
  if (!phoneNumber) {
    throw ApiError.badRequest(
      'NO_WHATSAPP_NUMBER',
      'This workspace has no connected WhatsApp number yet, so a chat cannot be started.',
    );
  }

  const conversation = await repo.findOrCreateConversation(tenantId, contactId, String(phoneNumber._id));
  return toPublicConversation(conversation, contact);
}

/**
 * Deletes a chat from this workspace: the conversation and every message in
 * it. Local to VOXO only — Meta's Cloud API cannot recall anything already
 * delivered, so the customer's own WhatsApp thread is untouched.
 */
export async function deleteConversationForTenant(tenantId: string, id: string, actorId: string): Promise<void> {
  const conversation = await repo.findConversationByIdAndTenant(id, tenantId);
  if (!conversation) {
    throw ApiError.notFound('CONVERSATION_NOT_FOUND', 'That conversation does not exist.');
  }
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
  tenantId: string,
  actorUserId: string,
  ids: string[],
  action: BulkConversationAction,
): Promise<BulkConversationResult> {
  let affected = 0;

  if (action === 'delete') {
    const deletedIds = await repo.deleteConversationsByIds(ids, tenantId);
    // Messages are cascaded for exactly the ids that were really deleted —
    // deleteConversationsByIds returns those, so nothing belonging to
    // another tenant can be reached through this.
    for (const id of deletedIds) {
      await deleteMessagesByConversation(tenantId, id);
    }
    affected = deletedIds.length;
  } else if (action === 'read') {
    affected = await repo.markConversationsRead(ids, tenantId);
  } else {
    affected = await repo.setStatusForConversations(ids, tenantId, action === 'archive' ? 'ARCHIVED' : 'OPEN');
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
  tenantId: string,
  actorUserId: string,
  id: string,
  patch: UpdateConversationBody,
): Promise<PublicConversation> {
  let conversation = await repo.findConversationByIdAndTenant(id, tenantId);
  if (!conversation) {
    throw ApiError.notFound('CONVERSATION_NOT_FOUND', 'Conversation not found');
  }

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
