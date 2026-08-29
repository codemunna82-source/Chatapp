import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

// Covers spec §30's notification triggers: incoming messages, failures,
// subscription expiry, and other account events.
export const NOTIFICATION_TYPES = [
  'MESSAGE_RECEIVED',
  'MESSAGE_FAILED',
  'SUBSCRIPTION_EXPIRING',
  'SUBSCRIPTION_EXPIRED',
  'ACCOUNT_DISABLED',
  'CALL_MISSED',
  'SYSTEM',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const notificationSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    data: { type: Schema.Types.Mixed }, // e.g. { conversationId } for deep-linking (spec §31)
    readAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Keyed on _id because that is what the list actually sorts and paginates
// by (`.sort({_id:-1})` with an `_id < cursor` range). The createdAt index
// this replaces matched the filter but not the sort, so every page loaded
// the whole matching set and sorted it in memory. ObjectId order is
// insertion order, so the rows come back in exactly the same sequence.
notificationSchema.index({ tenantId: 1, userId: 1, _id: -1 });
notificationSchema.index({ tenantId: 1, userId: 1, readAt: 1 });

export type NotificationDoc = HydratedDocument<InferSchemaType<typeof notificationSchema>>;
export const Notification = model('Notification', notificationSchema);
