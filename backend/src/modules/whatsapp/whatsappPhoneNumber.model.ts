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
    /** Meta-reported conversation cap: TIER_250 | TIER_1K | TIER_10K | TIER_100K | TIER_UNLIMITED. */
    messagingLimitTier: { type: String },
    /**
     * Meta's verdict on the business display name — APPROVED, PENDING_REVIEW,
     * DECLINED — and on the number itself.
     *
     * Stored so the customer-facing window can show a verification badge
     * that means something. The badge is Meta's statement, not ours: it is
     * shown only when Meta says APPROVED, and there is deliberately no way
     * to set it by hand. A badge a business can switch on for itself is
     * worth nothing to the customer looking at it, and claiming WhatsApp
     * vouched for an account it has not reviewed is the kind of thing that
     * gets a number banned.
     */
    nameStatus: { type: String },
    codeVerificationStatus: { type: String },
    /**
     * When the two fields above were last read from Meta.
     *
     * They used to be written once, at registration, and never again — so
     * a number that was GREEN the day it was connected reported GREEN
     * forever, including after Meta had moved it to RED. A rating nobody
     * refreshes is worse than none: it is a warning light wired to
     * nothing. This is what makes staleness visible and refreshable.
     */
    healthCheckedAt: { type: Date },
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
