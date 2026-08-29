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
    wabaId: { type: String, required: true }, // Meta WhatsApp Business Account ID
    businessName: { type: String, trim: true },
    /**
     * Legacy plaintext token. Kept readable so accounts created before
     * encryption existed keep working; the backfill migrates them into
     * accessTokenEnc and clears this. No new write ever sets it.
     */
    accessTokenRef: { type: String, select: false },
    /** AES-256-GCM envelope from lib/crypto.ts — see encryptSecret. */
    accessTokenEnc: { type: String, select: false },
    /** Meta Business (portfolio) id returned by Embedded Signup. */
    businessId: { type: String },
    disconnectedAt: { type: Date },
    verifyToken: { type: String, required: true, select: false },
    status: { type: String, enum: WABA_STATUSES, default: 'PENDING', required: true },
    connectedAt: { type: Date },
  },
  { timestamps: true },
);

// NOT unique on wabaId alone any more. Two of this app's users can
// legitimately onboard under the same Meta WhatsApp Business Account —
// a business with several numbers, one per staff member — and a global
// unique constraint would reject the second one with a duplicate-key
// error that looks like a bug rather than a rule.
whatsappAccountSchema.index({ wabaId: 1, ownerUserId: 1 }, { unique: true });
whatsappAccountSchema.index({ tenantId: 1, ownerUserId: 1 });

export type WhatsAppAccountDoc = HydratedDocument<InferSchemaType<typeof whatsappAccountSchema>>;
export const WhatsAppAccount = model('WhatsAppAccount', whatsappAccountSchema);
