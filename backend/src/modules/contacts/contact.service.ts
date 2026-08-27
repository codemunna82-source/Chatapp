import { ApiError } from '../../lib/ApiError';
import { recordAudit } from '../audit/auditLog.service';
import * as repo from './contact.repository';
import type { ContactDoc } from './contact.model';

export interface PublicContact {
  id: string;
  tenantId: string;
  phone: string;
  name?: string;
  avatarUrl?: string;
  tags: string[];
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
