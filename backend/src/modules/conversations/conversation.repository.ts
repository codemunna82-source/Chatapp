import { Types } from 'mongoose';
import { Conversation, type ConversationDoc, type ConversationLean, type ConversationStatus } from './conversation.model';

const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The chat list's page cursor.
 *
 * It has to carry all three sort keys, not just the _id. The list is
 * ordered (pinned desc, updatedAt desc, _id desc), and the previous
 * implementation asked for `_id < cursor` — a field unrelated to that
 * order. Any conversation with an older _id but newer activity than the
 * last row of page 1 was silently dropped from page 2, and anything
 * pinned after the fact could appear on two pages at once. Scrolling a
 * busy inbox lost chats.
 *
 * Opaque to the client, which only ever echoes back what it was given.
 */
export interface ConversationCursor {
  pinned: boolean;
  updatedAt: Date;
  id: Types.ObjectId;
}

/** Exported for conversationCursor.test.ts — not part of the module's API. */
export function encodeCursorParts(pinned: boolean, updatedAt: Date, id: string): string {
  return Buffer.from(`${pinned ? 1 : 0}:${updatedAt.getTime()}:${id}`).toString('base64url');
}

function encodeCursor(doc: ConversationLean): string {
  return encodeCursorParts(doc.pinned, doc.updatedAt, String(doc._id));
}

export function decodeCursor(raw: string): ConversationCursor | null {
  try {
    const [pinned, updatedAt, id] = Buffer.from(raw, 'base64url').toString('utf8').split(':');
    if (!pinned || !updatedAt || !id || !Types.ObjectId.isValid(id)) return null;
    const millis = Number(updatedAt);
    if (!Number.isFinite(millis)) return null;
    return { pinned: pinned === '1', updatedAt: new Date(millis), id: new Types.ObjectId(id) };
  } catch {
    return null;
  }
}

/**
 * Standard keyset ("seek") predicate for "strictly after this row" under
 * (pinned desc, updatedAt desc, _id desc). Each branch pins the keys to
 * its left to equality, so every branch is a range scan on the compound
 * index rather than a scan-and-filter.
 *
 * `pinned: { $lt: true }` reads oddly but is right: BSON orders false
 * below true, and descending order puts pinned chats first, so everything
 * after a pinned row is either another pinned row or an unpinned one.
 */
export function afterCursor(cursor: ConversationCursor): Record<string, unknown>[] {
  return [
    { pinned: { $lt: cursor.pinned } },
    { pinned: cursor.pinned, updatedAt: { $lt: cursor.updatedAt } },
    { pinned: cursor.pinned, updatedAt: cursor.updatedAt, _id: { $lt: cursor.id } },
  ];
}

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

/**
 * Existence + ownership only, for callers that just need to tell "not
 * found" from "empty" — the message list runs this on every page it
 * fetches, and pulling the whole conversation document to look at nothing
 * but whether it came back was the more expensive half of that request.
 */
export async function conversationExistsForTenant(id: string, tenantId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(id)) return false;
  const found = await Conversation.exists({ _id: id, tenantId });
  return found !== null;
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
): Promise<{ items: ConversationLean[]; nextCursor: string | null }> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const filter: Record<string, unknown> = { tenantId };
  if (opts.pinnedOnly) filter.pinned = true;
  if (opts.status) filter.status = opts.status;
  if (opts.contactIds) {
    filter.contactId = { $in: opts.contactIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id)) };
  }
  if (opts.cursor) {
    const cursor = decodeCursor(opts.cursor);
    if (cursor) {
      filter.$or = afterCursor(cursor);
    } else if (Types.ObjectId.isValid(opts.cursor)) {
      // A cursor issued by the previous build. Honoured rather than
      // rejected so a client mid-scroll across a deploy keeps working; it
      // is as approximate as it always was, and the next page it returns
      // carries a proper cursor.
      filter._id = { $lt: new Types.ObjectId(opts.cursor) };
    }
  }

  // .lean() for the same reason as the message list: these rows are
  // serialised and never mutated.
  const items = await Conversation.find(filter)
    .sort({ pinned: -1, updatedAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<ConversationLean[]>();
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return { items: page, nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null };
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

/** Clears both the real count and a manual "mark as unread" — opening the
 *  chat is exactly the action that undoes either. */
export async function markConversationRead(id: string, tenantId: string): Promise<ConversationDoc | null> {
  return Conversation.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: { unreadCount: 0, manuallyUnread: false } },
    { new: true },
  );
}

/** "Mark as unread" — see the model's note on why this is a flag rather
 *  than a fabricated unreadCount of 1. */
export async function markConversationUnread(id: string, tenantId: string): Promise<ConversationDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return Conversation.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: { manuallyUnread: true } },
    { new: true },
  );
}

/**
 * Bulk status change for a multi-select action. One query rather than N
 * round trips, so twenty chats archive atomically instead of half-applying
 * if the connection drops midway.
 */
export async function setStatusForConversations(
  ids: string[],
  tenantId: string,
  status: ConversationStatus,
): Promise<number> {
  const valid = ids.filter((id) => Types.ObjectId.isValid(id));
  if (valid.length === 0) return 0;
  const result = await Conversation.updateMany({ _id: { $in: valid }, tenantId }, { $set: { status } });
  return result.modifiedCount;
}

/** Bulk read — the multi-select counterpart of markConversationRead. */
export async function markConversationsRead(ids: string[], tenantId: string): Promise<number> {
  const valid = ids.filter((id) => Types.ObjectId.isValid(id));
  if (valid.length === 0) return 0;
  const result = await Conversation.updateMany(
    { _id: { $in: valid }, tenantId },
    { $set: { unreadCount: 0, manuallyUnread: false } },
  );
  return result.modifiedCount;
}

/** Bulk delete. Returns the ids that actually belonged to this tenant, so
 *  the caller can cascade messages for exactly those and no others. */
export async function deleteConversationsByIds(ids: string[], tenantId: string): Promise<string[]> {
  const valid = ids.filter((id) => Types.ObjectId.isValid(id));
  if (valid.length === 0) return [];
  const owned = await Conversation.find({ _id: { $in: valid }, tenantId }).select('_id');
  const ownedIds = owned.map((c) => String(c._id));
  if (ownedIds.length === 0) return [];
  await Conversation.deleteMany({ _id: { $in: ownedIds }, tenantId });
  return ownedIds;
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
        lastMessageDirection: 'IN',
        // An inbound message has no delivery status of ours to show — the
        // row renders no tick for it, rather than a stale one from the
        // outbound message it replaced.
        lastMessageStatus: null,
        lastMessageId: null,
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
  status = 'SENT',
  messageId?: string,
): Promise<ConversationDoc | null> {
  return Conversation.findOneAndUpdate(
    { _id: id, tenantId },
    {
      $set: {
        lastMessageAt: at,
        lastMessagePreview: preview,
        lastMessageDirection: 'OUT',
        lastMessageStatus: status,
        ...(messageId ? { lastMessageId: messageId } : {}),
      },
    },
    { new: true },
  );
}

/**
 * Keeps the chat row's tick in step with a status webhook.
 *
 * Scoped to lastMessageId so a late status for an older message cannot
 * rewrite the row to describe something that is no longer the last thing
 * in the chat.
 */
export async function updateLastMessageStatus(
  tenantId: string,
  messageId: string,
  status: string,
): Promise<void> {
  if (!Types.ObjectId.isValid(messageId)) return;
  await Conversation.updateOne(
    { tenantId, lastMessageId: new Types.ObjectId(messageId) },
    { $set: { lastMessageStatus: status } },
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
