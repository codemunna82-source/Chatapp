import { Types } from 'mongoose';
import { Conversation, type ConversationDoc, type ConversationStatus } from './conversation.model';

const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function findOrCreateConversation(
  tenantId: string,
  contactId: string,
  whatsappPhoneNumberId: string,
): Promise<ConversationDoc> {
  const existing = await Conversation.findOne({ tenantId, contactId });
  if (existing) return existing;
  return Conversation.create({ tenantId, contactId, whatsappPhoneNumberId });
}

export async function findConversationByIdAndTenant(
  id: string,
  tenantId: string,
): Promise<ConversationDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return Conversation.findOne({ _id: id, tenantId });
}

export interface ListConversationsOptions {
  cursor?: string;
  limit?: number;
  pinnedOnly?: boolean;
  /**
   * Restricts the list to conversations for these contacts — used by the
   * search flow (conversation.service.ts resolves matching contacts first,
   * then passes their ids here), so this repository stays free of any
   * cross-collection query logic of its own.
   */
  contactIds?: string[];
  status?: ConversationStatus;
}

/**
 * Pinned conversations first, then by most recent activity — matches the
 * chat-list UX in spec §19. Cursor pagination on `_id` within each of the
 * two segments keeps this cheap even with a large chat list; never loads
 * the full history into memory (spec §19, §28).
 */
export async function listConversationsByTenant(
  tenantId: string,
  opts: ListConversationsOptions = {},
): Promise<{ items: ConversationDoc[]; nextCursor: string | null }> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const filter: Record<string, unknown> = { tenantId };
  if (opts.pinnedOnly) filter.pinned = true;
  if (opts.status) filter.status = opts.status;
  if (opts.contactIds) {
    filter.contactId = { $in: opts.contactIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id)) };
  }
  if (opts.cursor && Types.ObjectId.isValid(opts.cursor)) {
    filter._id = { $lt: new Types.ObjectId(opts.cursor) };
  }

  const items = await Conversation.find(filter)
    .sort({ pinned: -1, updatedAt: -1, _id: -1 })
    .limit(limit + 1);
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return { items: page, nextCursor: hasMore ? String(page[page.length - 1]!._id) : null };
}

export async function deleteConversation(id: string, tenantId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(id)) return false;
  const result = await Conversation.deleteOne({ _id: id, tenantId });
  return result.deletedCount > 0;
}

export async function deleteConversationsByContact(tenantId: string, contactId: string): Promise<string[]> {
  const docs = await Conversation.find({ tenantId, contactId }).select('_id');
  const ids = docs.map((d) => String(d._id));
  if (ids.length > 0) await Conversation.deleteMany({ tenantId, contactId });
  return ids;
}

export async function setConversationPinned(
  id: string,
  tenantId: string,
  pinned: boolean,
): Promise<ConversationDoc | null> {
  return Conversation.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: { pinned, pinnedAt: pinned ? new Date() : undefined } },
    { new: true },
  );
}

export async function setConversationStatus(
  id: string,
  tenantId: string,
  status: ConversationStatus,
): Promise<ConversationDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return Conversation.findOneAndUpdate({ _id: id, tenantId }, { $set: { status } }, { new: true });
}

export async function markConversationRead(id: string, tenantId: string): Promise<ConversationDoc | null> {
  return Conversation.findOneAndUpdate({ _id: id, tenantId }, { $set: { unreadCount: 0 } }, { new: true });
}

/** Called after persisting an inbound (customer) message — advances the 24h window. */
export async function recordInboundActivity(
  id: string,
  tenantId: string,
  preview: string,
  at: Date = new Date(),
): Promise<ConversationDoc | null> {
  return Conversation.findOneAndUpdate(
    { _id: id, tenantId },
    {
      $set: {
        lastMessageAt: at,
        lastMessagePreview: preview,
        lastCustomerMessageAt: at,
        conversationWindowExpiresAt: new Date(at.getTime() + CUSTOMER_SERVICE_WINDOW_MS),
      },
      $inc: { unreadCount: 1 },
    },
    { new: true },
  );
}

/** Called after successfully sending an outbound (business) message — does NOT touch the window. */
export async function recordOutboundActivity(
  id: string,
  tenantId: string,
  preview: string,
  at: Date = new Date(),
): Promise<ConversationDoc | null> {
  return Conversation.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: { lastMessageAt: at, lastMessagePreview: preview } },
    { new: true },
  );
}

/**
 * Authoritative 24-hour customer-service-window check (spec §18). Must be
 * called server-side before every free-form send — never trust an Android
 * client's own countdown.
 */
export function isWithinCustomerServiceWindow(
  conversation: Pick<ConversationDoc, 'conversationWindowExpiresAt'>,
  now: Date = new Date(),
): boolean {
  if (!conversation.conversationWindowExpiresAt) return false;
  return now.getTime() < conversation.conversationWindowExpiresAt.getTime();
}
