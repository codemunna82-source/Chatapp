import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

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
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    whatsappPhoneNumberId: { type: Schema.Types.ObjectId, ref: 'WhatsAppPhoneNumber', required: true },
    lastMessageAt: { type: Date },
    lastMessagePreview: { type: String },
    lastCustomerMessageAt: { type: Date },
    conversationWindowExpiresAt: { type: Date },
    unreadCount: { type: Number, default: 0, min: 0 },
    pinned: { type: Boolean, default: false },
    pinnedAt: { type: Date },
    status: { type: String, enum: CONVERSATION_STATUSES, default: 'OPEN', required: true },
  },
  { timestamps: true },
);

// One conversation per (tenant, contact) — matches spec's Conversation-per-Contact model.
conversationSchema.index({ tenantId: 1, contactId: 1 }, { unique: true });
// Chat list sorted by recent activity.
conversationSchema.index({ tenantId: 1, updatedAt: -1 });
// Pinned-first chat list.
conversationSchema.index({ tenantId: 1, pinned: 1, lastMessageAt: -1 });

export type ConversationDoc = HydratedDocument<InferSchemaType<typeof conversationSchema>>;
export const Conversation = model('Conversation', conversationSchema);
