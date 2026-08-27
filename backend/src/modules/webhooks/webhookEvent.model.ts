import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const WEBHOOK_EVENT_STATUSES = ['RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED'] as const;
export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUSES)[number];

/**
 * Raw Meta webhook deliveries. NOT tenant-scoped at write time — tenant is
 * resolved from `phoneNumberId` during processing (see whatsapp.repository
 * findPhoneNumberByMetaId) and stored here once known, for audit/debugging.
 * `metaEventId` is unique so a duplicate Meta delivery (their documented
 * at-least-once behavior) is a guaranteed no-op (spec §16).
 */
const webhookEventSchema = new Schema(
  {
    metaEventId: { type: String, required: true },
    phoneNumberId: { type: String, required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' }, // filled in once resolved
    payload: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: WEBHOOK_EVENT_STATUSES, default: 'RECEIVED', required: true },
    processedAt: { type: Date },
    error: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

webhookEventSchema.index({ metaEventId: 1 }, { unique: true });
webhookEventSchema.index({ tenantId: 1, createdAt: -1 });

export type WebhookEventDoc = HydratedDocument<InferSchemaType<typeof webhookEventSchema>>;
export const WebhookEvent = model('WebhookEvent', webhookEventSchema);
