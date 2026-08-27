import { Types } from 'mongoose';
import { Contact, type ContactDoc } from './contact.model';

export interface CreateContactInput {
  tenantId: string;
  phone: string;
  name?: string;
  avatarUrl?: string;
  tags?: string[];
}

export async function createContact(input: CreateContactInput): Promise<ContactDoc> {
  return Contact.create(input);
}

export async function findContactByIdAndTenant(id: string, tenantId: string): Promise<ContactDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return Contact.findOne({ _id: id, tenantId });
}

export async function findContactByPhoneAndTenant(phone: string, tenantId: string): Promise<ContactDoc | null> {
  return Contact.findOne({ phone, tenantId });
}

/** Idempotent — used by the inbound-webhook flow to attach a Message to a Contact. */
export async function findOrCreateContactByPhone(
  tenantId: string,
  phone: string,
  name?: string,
): Promise<ContactDoc> {
  const existing = await findContactByPhoneAndTenant(phone, tenantId);
  if (existing) return existing;
  return createContact({ tenantId, phone, name });
}

export interface ListContactsOptions {
  search?: string; // matches name prefix or phone substring
  cursor?: string;
  limit?: number;
}

export async function listContactsByTenant(
  tenantId: string,
  opts: ListContactsOptions = {},
): Promise<{ items: ContactDoc[]; nextCursor: string | null }> {
  const limit = Math.min(opts.limit ?? 30, 100);
  const filter: Record<string, unknown> = { tenantId };
  if (opts.search) {
    const escaped = opts.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ name: new RegExp(escaped, 'i') }, { phone: new RegExp(escaped, 'i') }];
  }
  if (opts.cursor && Types.ObjectId.isValid(opts.cursor)) {
    filter._id = { $lt: new Types.ObjectId(opts.cursor) };
  }

  const items = await Contact.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1);
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return { items: page, nextCursor: hasMore ? String(page[page.length - 1]!._id) : null };
}

export async function updateContactByIdAndTenant(
  id: string,
  tenantId: string,
  patch: Partial<Pick<CreateContactInput, 'name' | 'avatarUrl' | 'tags'>>,
): Promise<ContactDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return Contact.findOneAndUpdate({ _id: id, tenantId }, { $set: patch }, { new: true });
}
