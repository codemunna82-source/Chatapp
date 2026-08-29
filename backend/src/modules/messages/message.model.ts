import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import type { Timestamps, Lean } from '../../lib/modelTypes';

export const MESSAGE_DIRECTIONS = ['IN', 'OUT'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

/**
 * Officially supported WhatsApp Cloud API message types (spec §20) — never
 * extend with fake functionality. `sticker` and `unknown` are included
 * because Meta can deliver them inbound (a sticker message, or a type we
 * don't yet model) and ingestion must not crash on a real, documented
 * payload shape; we don't claim to *send* either of these.
 */
export const MESSAGE_TYPES = [
  'text',
  'image',
  'video',
  'audio',
  'document',
  'location',
  'contacts',
  'reaction',
  'template',
  'interactive',
  'sticker',
  'unknown',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const MESSAGE_STATUSES = ['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

const messageSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User' }, // absent for inbound (customer-sent) messages
    recipientPhone: { type: String, required: true },
    direction: { type: String, enum: MESSAGE_DIRECTIONS, required: true },
    type: { type: String, enum: MESSAGE_TYPES, required: true },
    text: { type: String },
    mediaId: { type: Schema.Types.ObjectId, ref: 'Media' },
    metaMessageId: { type: String }, // Meta's wamid — used to correlate status webhooks
    replyToMessageId: { type: Schema.Types.ObjectId, ref: 'Message' },
    status: { type: String, enum: MESSAGE_STATUSES, default: 'QUEUED', required: true },
    /**
     * When each delivery milestone happened, for the message-info view.
     *
     * `status` alone only says where a message got to, not when — and
     * "delivered" without a time cannot answer the question people actually
     * ask, which is whether the customer saw it before or after they
     * complained. Each is stamped from Meta's OWN webhook timestamp rather
     * than the moment we processed it: webhook delivery can lag by seconds
     * or, after an outage, minutes, and the customer's phone is the thing
     * being reported on, not our queue.
     *
     * Only meaningful on outbound messages, and only as far as the status
     * webhooks Meta actually sends — `readAt` stays empty forever if the
     * customer has read receipts turned off, which is a real answer, not a
     * missing one.
     */
    sentAt: { type: Date },
    deliveredAt: { type: Date },
    readAt: { type: Date },
    error: { type: Schema.Types.Mixed },
    /**
     * Soft delete, tenant-side only. Meta's Cloud API exposes no way to
     * recall a message that has already been delivered, so this hides it
     * from this workspace's inbox and nothing more — the customer's own
     * WhatsApp thread is unaffected. Kept as a timestamp rather than a hard
     * delete so the row still anchors replies and status webhooks.
     */
    deletedAt: { type: Date },
    /**
     * Workspace-wide, not per-user: this is a shared business inbox, and
     * "the message with the customer's delivery address" is important to
     * whoever picks the conversation up next, not just to whoever starred
     * it. A per-user star would need its own collection and would hide the
     * one useful signal behind whose account you happen to be in.
     */
    starredAt: { type: Date },
  },
  { timestamps: true },
);

// Paginated chat history, newest-first within a conversation — the single
// most frequently hit query pattern in the whole app.
//
// Keyed on _id, not createdAt, because that is what the query actually
// sorts and paginates by (see listMessagesByConversation: `.sort({_id:-1})`
// with an `_id < cursor` range). With the createdAt index Mongo could use
// the index to FIND the conversation's messages but then had to load and
// sort every one of them in memory to order by _id — a blocking SORT stage
// on the app's hottest read, which also fails outright past 32MB on a long
// thread. An ObjectId's leading bytes are a timestamp, so _id order is
// insertion order: nothing is lost by ordering on it.
messageSchema.index({ tenantId: 1, conversationId: 1, _id: -1 });
// The dashboard's lifetime totals group every message by direction and
// status. With only the (tenantId, createdAt) index below, that meant
// fetching each full document — text, error payloads and all — off disk
// purely to read two short fields. This index carries both, so the scan
// stays in the index and never touches the documents.
messageSchema.index({ tenantId: 1, direction: 1, status: 1 });
// Recent-activity feeds / dashboards.
messageSchema.index({ tenantId: 1, createdAt: -1 });
// Starred-only listing. Partial rather than sparse so the index holds only
// the handful of starred rows instead of an entry per message.
messageSchema.index(
  { tenantId: 1, conversationId: 1, starredAt: -1 },
  { partialFilterExpression: { starredAt: { $exists: true } } },
);
// Webhook status updates arrive keyed by Meta's message id — must resolve
// in O(1) and must be scoped correctly (sparse: most rows get one eventually,
// but IN messages/failed sends may briefly lack it).
messageSchema.index({ metaMessageId: 1 }, { unique: true, sparse: true });

type MessageAttrs = InferSchemaType<typeof messageSchema> & Timestamps;
export type MessageDoc = HydratedDocument<MessageAttrs>;
/** A `.lean()` row — see lib/modelTypes.ts. Structurally a superset-compatible
 *  match for MessageDoc, so serialisers accept either. */
export type MessageLean = Lean<MessageAttrs>;
export const Message = model('Message', messageSchema);
