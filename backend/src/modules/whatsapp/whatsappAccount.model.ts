import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const WABA_STATUSES = ['PENDING', 'CONNECTED', 'DISCONNECTED', 'ERROR'] as const;
export type WabaStatus = (typeof WABA_STATUSES)[number];

/**
 * One WhatsApp Business Account, connected through Meta's Embedded Signup.
 *
 * `ownerUserId` is the app user who connected it. Optional, because every
 * account that existed before Embedded Signup has none and is shared at
 * the tenant level — that is the fallback the read paths keep honouring.
 *
 * Two token fields, deliberately:
 * - `accessTokenEnc` holds the encrypted System User token Embedded Signup
 *   returned for this specific account (see lib/crypto.ts). This is the
 *   one that matters: a database dump must not be a set of live WhatsApp
 *   credentials for every connected customer.
 * - `accessTokenRef` is the older field, still carrying `mock:`/`env:`
 *   placeholders that defer to META_ACCESS_TOKEN. Kept so the existing
 *   single-number deployment keeps sending while accounts migrate.
 *
 * Neither is ever sent to Android; both are `select: false`.
 */
const whatsappAccountSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    /** The app user who ran Embedded Signup. Absent = tenant-wide (legacy). */
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    wabaId: { type: String, required: true }, // Meta WhatsApp Business Account ID
    businessName: { type: String, trim: true },
    /** AES-256-GCM envelope from lib/crypto.ts. Never plaintext. */
    accessTokenEnc: { type: String, select: false },
    accessTokenRef: { type: String, required: true, select: false }, // legacy placeholder, see above
    verifyToken: { type: String, required: true, select: false },
    status: { type: String, enum: WABA_STATUSES, default: 'PENDING', required: true },
    connectedAt: { type: Date },
  },
  { timestamps: true },
);

// Unique per tenant, NOT globally. A single WABA can legitimately appear
// twice: an agency and its client both onboard the same business, or one
// business is served by two workspaces. A global unique index would make
// the second Embedded Signup fail with a duplicate-key error that reads
// like a bug rather than a policy.
//
// Note this index must be created by syncIndexes(), not autoIndex: Mongoose
// creates new indexes but never drops ones a schema no longer declares, so
// the old global unique index survives an ordinary deploy and keeps
// rejecting the second tenant. See scripts/migrateWabaIndex.ts.
whatsappAccountSchema.index({ tenantId: 1, wabaId: 1 }, { unique: true });
whatsappAccountSchema.index({ ownerUserId: 1 });

export type WhatsAppAccountDoc = HydratedDocument<InferSchemaType<typeof whatsappAccountSchema>>;
export const WhatsAppAccount = model('WhatsAppAccount', whatsappAccountSchema);
