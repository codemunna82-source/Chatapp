import { Types } from 'mongoose';
import {
  Message,
  type MessageDoc,
  type MessageLean,
  type MessageStatus,
  type MessageType,
  type MessageDirection,
} from './message.model';

export interface CreateMessageInput {
  tenantId: string;
  conversationId: string;
  senderId?: string;
  recipientPhone: string;
  direction: MessageDirection;
  type: MessageType;
  text?: string;
  mediaId?: string;
  metaMessageId?: string;
  replyToMessageId?: string;
  status?: MessageStatus;
}

export async function createMessage(input: CreateMessageInput): Promise<MessageDoc> {
  return Message.create(input);
}

export async function findMessageByIdAndTenant(id: string, tenantId: string): Promise<MessageDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return Message.findOne({ _id: id, tenantId });
}

/**
 * `metaMessageId` (Meta's wamid) is globally unique on its own, but every
 * lookup still filters by tenantId — the pattern every tenant-owned query
 * in this codebase follows (spec §13), and a cheap extra guard against a
 * webhook ever being processed against the wrong tenant.
 */
export async function findMessageByMetaIdAndTenant(
  metaMessageId: string,
  tenantId: string,
): Promise<MessageDoc | null> {
  return Message.findOne({ metaMessageId, tenantId });
}

export interface ListMessagesOptions {
  cursor?: string; // opaque cursor = _id of the oldest message already loaded
  limit?: number;
  /** Case-insensitive substring match against the message text. */
  search?: string;
  /** Restrict to starred messages only. */
  starredOnly?: boolean;
}

/**
 * User input goes into a RegExp here, so every regex metacharacter has to
 * be neutralised first. Without this, a search for "c++" or "(" is either a
 * syntax error or — worse — a pattern like ".*" that quietly means
 * something other than what was typed.
 */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Newest-first page of a conversation's history. The chat screen renders
 * newest at the bottom and loads older messages upward (spec §19) by
 * requesting the next page with the previous page's oldest `_id` as cursor
 * — the full history is never fetched or held in memory at once.
 */
export async function listMessagesByConversation(
  tenantId: string,
  conversationId: string,
  opts: ListMessagesOptions = {},
): Promise<{ items: MessageLean[]; nextCursor: string | null }> {
  const limit = Math.min(opts.limit ?? 30, 100);
  // Soft-deleted messages never come back down the wire.
  const filter: Record<string, unknown> = { tenantId, conversationId, deletedAt: { $exists: false } };
  if (opts.cursor && Types.ObjectId.isValid(opts.cursor)) {
    filter._id = { $lt: new Types.ObjectId(opts.cursor) };
  }
  if (opts.starredOnly) {
    filter.starredAt = { $exists: true };
  }
  if (opts.search) {
    // Regex rather than a $text index: $text matches whole words only, so
    // it would miss "9876" inside a phone number and "invoice" inside
    // "invoice-2024" — both of which are exactly what someone searching a
    // customer thread is looking for. The query is already narrowed to one
    // conversation by an index, so the scan is over a bounded set.
    filter.text = { $regex: escapeRegex(opts.search), $options: 'i' };
  }

  // .lean(): this page is serialised straight to JSON and no document
  // method is ever called on it, so the Mongoose document wrapper around
  // each of up to 100 rows is pure overhead.
  const items = await Message.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean<MessageLean[]>();
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return { items: page, nextCursor: hasMore ? String(page[page.length - 1]!._id) : null };
}

/** Soft-deletes one message for this tenant (see the model's deletedAt note). */
export async function softDeleteMessage(id: string, tenantId: string): Promise<MessageDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return Message.findOneAndUpdate({ _id: id, tenantId }, { $set: { deletedAt: new Date() } }, { new: true });
}

/** Hard-deletes every message in a conversation — used when the chat itself is deleted. */
export async function deleteMessagesByConversation(tenantId: string, conversationId: string): Promise<void> {
  await Message.deleteMany({ tenantId, conversationId });
}

/** Which timestamp field each status milestone stamps. FAILED and QUEUED
 *  have none — there is no delivery moment to record. */
const STATUS_TIMESTAMP_FIELD: Partial<Record<MessageStatus, 'sentAt' | 'deliveredAt' | 'readAt'>> = {
  SENT: 'sentAt',
  DELIVERED: 'deliveredAt',
  READ: 'readAt',
};

export async function updateMessageStatusByMetaId(
  metaMessageId: string,
  tenantId: string,
  status: MessageStatus,
  error?: unknown,
  at?: Date,
): Promise<MessageDoc | null> {
  const field = STATUS_TIMESTAMP_FIELD[status];
  const timestamp = at ?? new Date();

  // $max, not $set: Meta does not guarantee status webhooks arrive in
  // order, and a delayed "sent" landing after "delivered" must not stamp a
  // later time onto an earlier milestone. $max on a missing field just
  // sets it, so first-write still works.
  return Message.findOneAndUpdate(
    { metaMessageId, tenantId },
    {
      $set: { status, ...(error !== undefined ? { error } : {}) },
      ...(field ? { $max: { [field]: timestamp } } : {}),
    },
    { new: true },
  );
}

export async function attachMetaMessageId(
  id: string,
  tenantId: string,
  metaMessageId: string,
): Promise<MessageDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  // Stamped locally: this is the moment Meta accepted the send, which is
  // the only "sent" time we observe directly rather than via a webhook.
  return Message.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: { metaMessageId, status: 'SENT' }, $max: { sentAt: new Date() } },
    { new: true },
  );
}

export async function markMessageFailed(id: string, tenantId: string, error: unknown): Promise<MessageDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return Message.findOneAndUpdate({ _id: id, tenantId }, { $set: { status: 'FAILED', error } }, { new: true });
}

/**
 * Stars or unstars one message. Idempotent: starring an already-starred
 * message keeps its original timestamp rather than bumping it, so a
 * starred list stays in the order things were actually marked.
 */
export async function setMessageStarred(
  id: string,
  tenantId: string,
  starred: boolean,
): Promise<MessageDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  if (starred) {
    // Only sets starredAt on a message that has none — re-starring keeps
    // the original timestamp instead of jumping the row to the top.
    const updated = await Message.findOneAndUpdate(
      { _id: id, tenantId, starredAt: { $exists: false } },
      { $set: { starredAt: new Date() } },
      { new: true },
    );
    return updated ?? Message.findOne({ _id: id, tenantId });
  }
  return Message.findOneAndUpdate({ _id: id, tenantId }, { $unset: { starredAt: 1 } }, { new: true });
}
