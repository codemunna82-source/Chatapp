import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import type { Timestamps, Lean } from '../../lib/modelTypes';

export const CONVERSATION_STATUSES = ['OPEN', 'ARCHIVED'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/**
 * `lastCustomerMessageAt` / `conversationWindowExpiresAt` back the Meta
 * 24-hour customer-service-window rule (spec §18): every inbound message
 * bumps `lastCustomerMessageAt` and recomputes `conversationWindowExpiresAt`
 * (= lastCustomerMessageAt + 24h). The outgoing-message service checks this
 * field — server-side, never on Android — before allowing a free-form send.
 */
const conversationSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    /**
     * The User whose connected WhatsApp number this belongs to.
     *
     * Optional: rows written before per-user numbers existed have none.
     * The backfill assigns them to the tenant's MASTER_ADMIN, and until it
     * runs a missing value reads as admin-owned rather than orphaned.
     */
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    whatsappPhoneNumberId: { type: Schema.Types.ObjectId, ref: 'WhatsAppPhoneNumber', required: true },
    lastMessageAt: { type: Date },
    lastMessagePreview: { type: String },
    /**
     * Enough about the last message to render a WhatsApp-style chat row
     * without a second query per conversation.
     *
     * Denormalised on purpose: the alternative is one lookup per row on a
     * screen that is nothing but rows. `lastMessageId` is what lets a
     * status webhook find the row to update — matching on preview text
     * would break the moment two messages read the same.
     */
    lastMessageDirection: { type: String, enum: ['IN', 'OUT'] },
    lastMessageStatus: { type: String },
    lastMessageId: { type: Schema.Types.ObjectId, ref: 'Message' },
    lastCustomerMessageAt: { type: Date },
    conversationWindowExpiresAt: { type: Date },
    unreadCount: { type: Number, default: 0, min: 0 },
    /**
     * "Mark as unread", kept separate from unreadCount rather than faking a
     * count of 1.
     *
     * The chat list shows unreadCount as a number badge. Bumping it to
     * claim one unread message when the user has read all of them would be
     * a lie the UI then repeats — and the next inbound message would make
     * it "2" for one actual unread. This flag drives the unread STYLING
     * (bold row, dot) while the badge keeps showing the real count.
     *
     * Cleared by the same paths that clear unreadCount: opening the chat.
     */
    manuallyUnread: { type: Boolean, default: false },
    pinned: { type: Boolean, default: false },
    pinnedAt: { type: Date },
    status: { type: String, enum: CONVERSATION_STATUSES, default: 'OPEN', required: true },
  },
  { timestamps: true },
);

// One conversation per (tenant, owner, contact).
//
// ownerUserId is in the key because two users in the same tenant, each
// with their own WhatsApp number, must be able to hold separate threads
// with the same customer — under the old (tenant, contact) key the second
// one failed with a duplicate-key error.
//
// The old index is NOT removed by Mongoose when this definition changes;
// scripts/backfillOwnerUserId.ts drops it explicitly. Until that runs the
// stale unique index is still enforced and still blocks the second thread.
conversationSchema.index({ tenantId: 1, ownerUserId: 1, contactId: 1 }, { unique: true });
// The chat list, exactly as it is sorted and paginated: pinned first, then
// most recent, with _id breaking ties and carrying the keyset cursor (see
// listConversationsByTenant). All four fields in the sort's own order and
// direction, so Mongo walks the index and stops at the page size instead of
// loading the tenant's whole chat list to sort it.
//
// This replaces two indexes that each covered part of the query — one on
// updatedAt that could not express "pinned first", and one on
// (pinned, lastMessageAt) that sorted by a field the list does not order
// by — so neither could serve the sort and every page paid a blocking
// SORT stage.
conversationSchema.index({ tenantId: 1, pinned: -1, updatedAt: -1, _id: -1 });

type ConversationAttrs = InferSchemaType<typeof conversationSchema> & Timestamps;
export type ConversationDoc = HydratedDocument<ConversationAttrs>;
/** A `.lean()` row — see lib/modelTypes.ts. Structurally a superset-compatible
 *  match for ConversationDoc, so serialisers accept either. */
export type ConversationLean = Lean<ConversationAttrs>;
export const Conversation = model('Conversation', conversationSchema);
