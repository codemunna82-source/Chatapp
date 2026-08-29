import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const PHONE_NUMBER_STATUSES = ['PENDING', 'CONNECTED', 'DISCONNECTED', 'RESTRICTED'] as const;
export type PhoneNumberStatus = (typeof PHONE_NUMBER_STATUSES)[number];

const whatsappPhoneNumberSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    /**
     * The User this belongs to.
     *
     * VOXO scopes data by tenant; per-user WhatsApp numbers add a second,
     * narrower axis: a SUB_USER sees only what their own connected number
     * produced, while a MASTER_ADMIN sees everything in the tenant.
     *
     * Optional because rows written before this existed have no owner. The
     * backfill (scripts/backfillOwnerUserId.ts) assigns them to the
     * tenant's MASTER_ADMIN; until it runs, a missing value is treated as
     * admin-owned rather than as belonging to nobody.
     */
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    whatsappAccountId: { type: Schema.Types.ObjectId, ref: 'WhatsAppAccount', required: true, index: true },
    phoneNumberId: { type: String, required: true }, // Meta phone_number_id — webhook tenant resolution key
    displayPhoneNumber: { type: String, required: true },
    qualityRating: { type: String }, // Meta-reported: GREEN | YELLOW | RED | UNKNOWN
    /** Meta's verified business display name for this number. */
    verifiedName: { type: String },
    /** Meta-reported: VERIFIED | NOT_VERIFIED | EXPIRED. */
    codeVerificationStatus: { type: String },
    /** Set once POST /{phone-number-id}/register has succeeded — until then the number cannot send via Cloud API. */
    registeredAt: { type: Date },
    status: { type: String, enum: PHONE_NUMBER_STATUSES, default: 'PENDING', required: true },
  },
  { timestamps: true },
);

// The single most important index in this collection: every inbound Meta
// webhook carries phone_number_id and nothing else identifying tenancy —
// this is how the webhook handler resolves which tenant an event belongs to.
whatsappPhoneNumberSchema.index({ phoneNumberId: 1 }, { unique: true });

export type WhatsAppPhoneNumberDoc = HydratedDocument<InferSchemaType<typeof whatsappPhoneNumberSchema>>;
export const WhatsAppPhoneNumber = model('WhatsAppPhoneNumber', whatsappPhoneNumberSchema);
