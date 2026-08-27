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

notificationSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
notificationSchema.index({ tenantId: 1, userId: 1, readAt: 1 });

export type NotificationDoc = HydratedDocument<InferSchemaType<typeof notificationSchema>>;
export const Notification = model('Notification', notificationSchema);
