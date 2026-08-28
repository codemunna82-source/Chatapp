import { ApiError } from '../../lib/ApiError';
import { recordAudit } from '../audit/auditLog.service';
import * as repo from './conversation.repository';
import * as contactRepo from '../contacts/contact.repository';
import { findFirstPhoneNumberForTenant } from '../whatsapp/whatsapp.repository';
import { toPublicContact, type PublicContact } from '../contacts/contact.service';
import type { ConversationDoc, ConversationStatus } from './conversation.model';
import type { ContactDoc } from '../contacts/contact.model';

export interface PublicConversation {
  id: string;
  tenantId: string;
  contactId: string;
  contact?: PublicContact;
  whatsappPhoneNumberId: string;
  lastMessageAt?: Date;
  lastMessagePreview?: string;
  lastCustomerMessageAt?: Date;
  conversationWindowExpiresAt?: Date;
  withinCustomerServiceWindow: boolean;
  unreadCount: number;
  pinned: boolean;
  pinnedAt?: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

function toPublicConversation(doc: ConversationDoc, contact?: ContactDoc): PublicConversation {
  return {
    id: String(doc._id),
    tenantId: String(doc.tenantId),
    contactId: String(doc.contactId),
    contact: contact ? toPublicContact(contact) : undefined,
    whatsappPhoneNumberId: String(doc.whatsappPhoneNumberId),
    lastMessageAt: doc.lastMessageAt ?? undefined,
    lastMessagePreview: doc.lastMessagePreview ?? undefined,
    lastCustomerMessageAt: doc.lastCustomerMessageAt ?? undefined,
    conversationWindowExpiresAt: doc.conversationWindowExpiresAt ?? undefined,
    withinCustomerServiceWindow: repo.isWithinCustomerServiceWindow(doc),
    unreadCount: doc.unreadCount,
    pinned: doc.pinned,
    pinnedAt: doc.pinnedAt ?? undefined,
    status: doc.status,
    createdAt: doc.get('createdAt'),
    updatedAt: doc.get('updatedAt'),
  };
}

/** Batch-fetches contacts for a page of conversations — one query, not N. */
async function enrichWithContacts(tenantId: string, conversations: ConversationDoc[]): Promise<PublicConversation[]> {
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
