import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const MESSAGE_DIRECTIONS = ['IN', 'OUT'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

/** Officially supported WhatsApp Cloud API message types (spec §20) — never extend with fake types. */
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
    error: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

// Paginated chat history, newest-first within a conversation — the
// single most frequently hit query pattern in the whole app.
messageSchema.index({ tenantId: 1, conversationId: 1, createdAt: -1 });
// Recent-activity feeds / dashboards.
messageSchema.index({ tenantId: 1, createdAt: -1 });
// Webhook status updates arrive keyed by Meta's message id — must resolve
// in O(1) and must be scoped correctly (sparse: most rows get one eventually,
// but IN messages/failed sends may briefly lack it).
messageSchema.index({ metaMessageId: 1 }, { unique: true, sparse: true });

export type MessageDoc = HydratedDocument<InferSchemaType<typeof messageSchema>>;
export const Message = model('Message', messageSchema);
