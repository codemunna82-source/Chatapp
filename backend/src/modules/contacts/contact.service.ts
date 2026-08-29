import { ApiError } from '../../lib/ApiError';
import { recordAudit } from '../audit/auditLog.service';
import * as repo from './contact.repository';
import type { ContactDoc } from './contact.model';
import { deleteConversationsByContact } from '../conversations/conversation.repository';
import { deleteMessagesByConversation } from '../messages/message.repository';

export interface PublicContact {
  id: string;
  tenantId: string;
  phone: string;
  name?: string;
  avatarUrl?: string;
  tags: string[];
  /** Seeded sample data — see contact.model.ts. */
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function toPublicContact(doc: ContactDoc): PublicContact {
  return {
    id: String(doc._id),
    tenantId: String(doc.tenantId),
    phone: doc.phone,
    name: doc.name ?? undefined,
    avatarUrl: doc.avatarUrl ?? undefined,
    tags: doc.tags ?? [],
    isDemo: doc.isDemo ?? false,
    createdAt: doc.get('createdAt'),
    updatedAt: doc.get('updatedAt'),
  };
}

export interface CreateContactBody {
  phone: string;
  name?: string;
  avatarUrl?: string;
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
  avatarUrl?: string;
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
