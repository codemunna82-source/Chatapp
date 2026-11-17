import { Types } from 'mongoose';
import { Contact, type ContactDoc, type ContactLean } from './contact.model';
import { normalizePhone, phoneVariants } from '../../lib/phone';

export interface CreateContactInput {
  tenantId: string;
  phone: string;
  name?: string;
  tags?: string[];
  /** Only the seed script sets this — see contact.model.ts. */
  isDemo?: boolean;
}

export async function deleteContact(id: string, tenantId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(id)) return false;
  const result = await Contact.deleteOne({ _id: id, tenantId });
  return result.deletedCount > 0;
}

export async function createContact(input: CreateContactInput): Promise<ContactDoc> {
  return Contact.create(input);
}

export async function findContactByIdAndTenant(id: string, tenantId: string): Promise<ContactDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return Contact.findOne({ _id: id, tenantId });
}

/** Batch lookup for enriching a page of conversations/messages without an N+1 query per row. */
/** Batch lookup behind the chat list's contact enrichment — read-only, so lean. */
export async function findContactsByIdsAndTenant(ids: string[], tenantId: string): Promise<ContactLean[]> {
  const validIds = ids.filter((id) => Types.ObjectId.isValid(id));
  if (validIds.length === 0) return [];
  return Contact.find({ _id: { $in: validIds }, tenantId }).lean<ContactLean[]>();
}

/**
 * Matches every stored form of the number, not just the string given.
 *
 * The REST API writes E.164 with a leading `+`; Meta's webhook delivers
 * bare digits and older rows were stored exactly as they arrived. Looking
 * up only one of those forms is what let the same customer exist twice —
 * see lib/phone.ts.
 */
export async function findContactByPhoneAndTenant(phone: string, tenantId: string): Promise<ContactDoc | null> {
  const variants = phoneVariants(phone);
  if (variants.length === 0) return null;
  return Contact.findOne({ phone: { $in: variants }, tenantId });
}

/**
 * Idempotent — used by the inbound-webhook flow to attach a Message to a
 * Contact, and by the web-chat link flow to find the same person by the
 * number an agent typed.
 *
 * Finds on any stored form, creates only in the canonical one, so the two
 * paths converge on one contact instead of the split closing only after a
 * migration.
 */
export async function findOrCreateContactByPhone(
  tenantId: string,
  phone: string,
  name?: string,
): Promise<ContactDoc> {
  const existing = await findContactByPhoneAndTenant(phone, tenantId);
  if (existing) return existing;
  // Falls back to the raw value when it cannot be parsed: a number we do
  // not recognise is still better stored than dropped.
  return createContact({ tenantId, phone: normalizePhone(phone) ?? phone, name });
}

export interface ListContactsOptions {
  search?: string; // matches name prefix or phone substring
  cursor?: string;
  limit?: number;
}

export async function listContactsByTenant(
  tenantId: string,
  opts: ListContactsOptions = {},
): Promise<{ items: ContactLean[]; nextCursor: string | null }> {
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
    .limit(limit + 1)
    .lean<ContactLean[]>();
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return { items: page, nextCursor: hasMore ? String(page[page.length - 1]!._id) : null };
}

export async function updateContactByIdAndTenant(
  id: string,
  tenantId: string,
  patch: Partial<Pick<CreateContactInput, 'name' | 'tags'>>,
): Promise<ContactDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return Contact.findOneAndUpdate({ _id: id, tenantId }, { $set: patch }, { new: true });
}

export interface ContactAvatarRef {
  url: string;
  contentType: string;
  cloudinaryPublicId?: string;
}

export async function setContactAvatar(
  id: string,
  tenantId: string,
  avatarUrl: string,
  contentType: string,
  cloudinaryPublicId: string,
): Promise<ContactDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return Contact.findOneAndUpdate(
    { _id: id, tenantId },
    {
      $set: {
        avatarUrl,
        avatarContentType: contentType,
        avatarCloudinaryPublicId: cloudinaryPublicId,
        avatarUpdatedAt: new Date(),
      },
    },
    { new: true },
  );
}

/** The select:false avatar fields, fetched explicitly — see the model. */
export async function findContactAvatarRefByIdAndTenant(
  id: string,
  tenantId: string,
): Promise<ContactAvatarRef | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  const contact = await Contact.findOne({ _id: id, tenantId }).select(
    '+avatarUrl +avatarContentType +avatarCloudinaryPublicId',
  );
  if (!contact || !contact.avatarUrl || !contact.avatarContentType) return null;
  return {
    url: contact.avatarUrl,
    contentType: contact.avatarContentType,
    cloudinaryPublicId: contact.avatarCloudinaryPublicId ?? undefined,
  };
}
