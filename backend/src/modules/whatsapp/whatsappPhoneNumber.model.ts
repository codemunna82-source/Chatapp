import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const PHONE_NUMBER_STATUSES = ['PENDING', 'CONNECTED', 'DISCONNECTED', 'RESTRICTED'] as const;
export type PhoneNumberStatus = (typeof PHONE_NUMBER_STATUSES)[number];

const whatsappPhoneNumberSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    whatsappAccountId: { type: Schema.Types.ObjectId, ref: 'WhatsAppAccount', required: true, index: true },
    /**
     * The app user this number belongs to. Set by Embedded Signup; absent
     * on numbers registered by an admin, which stay tenant-wide and are
     * assigned to users through User.whatsappPhoneNumberId instead.
     */
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    phoneNumberId: { type: String, required: true }, // Meta phone_number_id — webhook tenant resolution key
    displayPhoneNumber: { type: String, required: true },
    qualityRating: { type: String }, // Meta-reported: GREEN | YELLOW | RED | UNKNOWN
    status: { type: String, enum: PHONE_NUMBER_STATUSES, default: 'PENDING', required: true },
  },
  { timestamps: true },
);

// The single most important index in this collection: every inbound Meta
// webhook carries phone_number_id and nothing else identifying tenancy —
// this is how the webhook handler resolves which tenant an event belongs to.
whatsappPhoneNumberSchema.index({ phoneNumberId: 1 }, { unique: true });
whatsappPhoneNumberSchema.index({ ownerUserId: 1 });

export type WhatsAppPhoneNumberDoc = HydratedDocument<InferSchemaType<typeof whatsappPhoneNumberSchema>>;
export const WhatsAppPhoneNumber = model('WhatsAppPhoneNumber', whatsappPhoneNumberSchema);
