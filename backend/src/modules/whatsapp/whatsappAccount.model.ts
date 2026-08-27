import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const WABA_STATUSES = ['PENDING', 'CONNECTED', 'DISCONNECTED', 'ERROR'] as const;
export type WabaStatus = (typeof WABA_STATUSES)[number];

/**
 * One tenant may hold multiple WhatsApp Business Accounts (spec §15), each
 * connected via Meta's Embedded Signup flow. `accessTokenRef` is a pointer
 * into a secret store — the raw Meta access token is never stored in this
 * document/collection in plaintext, and must never be sent to Android.
 */
const whatsappAccountSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    wabaId: { type: String, required: true }, // Meta WhatsApp Business Account ID
    businessName: { type: String, trim: true },
    accessTokenRef: { type: String, required: true, select: false }, // secret-manager reference
    verifyToken: { type: String, required: true, select: false },
    status: { type: String, enum: WABA_STATUSES, default: 'PENDING', required: true },
    connectedAt: { type: Date },
  },
  { timestamps: true },
);

whatsappAccountSchema.index({ wabaId: 1 }, { unique: true });

export type WhatsAppAccountDoc = HydratedDocument<InferSchemaType<typeof whatsappAccountSchema>>;
export const WhatsAppAccount = model('WhatsAppAccount', whatsappAccountSchema);
