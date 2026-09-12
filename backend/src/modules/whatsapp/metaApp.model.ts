import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * One Meta app — that is, one Business Manager's set of credentials.
 *
 * Meta caps how many numbers a single Business Manager can hold, so a
 * workspace that outgrows one BM has to add another. A second BM is a
 * second Meta app, and a second Meta app means its own app secret, its own
 * verify token and its own access token. None of those can be shared: Meta
 * signs each webhook with the secret of the app subscribed to that WABA,
 * so a delivery from BM 2 verified against BM 1's secret fails, every
 * time, with nothing in the payload to explain it.
 *
 * That is the whole reason this model exists. Sending already worked
 * per-account (WhatsAppAccount.accessTokenEnc); receiving was the half
 * still pinned to one global META_APP_SECRET.
 *
 * Secrets are stored encrypted (lib/crypto.ts) and never returned to a
 * client — a database dump must not be a working set of WhatsApp
 * credentials for every business on the platform.
 */
const metaAppSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    /** What the admin calls this BM. Shown in pickers; never sent to Meta. */
    name: { type: String, required: true, trim: true, maxlength: 120 },
    /** Meta App ID. Not a secret — it appears in URLs and client config. */
    appId: { type: String, required: true, trim: true },
    /**
     * The last path segment of this app's webhook URL.
     *
     * Each Meta app gets its own callback URL, and this is what makes that
     * work: the URL says which app is calling before a single byte of the
     * body is trusted, which is the only point at which the right secret
     * can be chosen. Trying every known secret in turn would also be
     * sound, but it costs one HMAC per app per delivery and gets worse
     * with every workspace added — this stays constant.
     *
     * Globally unique, not per tenant: it IS the routing key, and one
     * URL cannot mean two apps.
     */
    webhookRef: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      minlength: 6,
      maxlength: 64,
      match: /^[a-z0-9-]+$/,
    },
    /** AES-256-GCM envelope. The secret Meta signs this app's webhooks with. */
    appSecretEnc: { type: String, required: true, select: false },
    /** Matched against hub.verify_token on this app's GET challenge. */
    verifyTokenEnc: { type: String, required: true, select: false },
    /**
     * The System User token for this BM, used when an account under it has
     * no token of its own. Optional: Embedded Signup stores a per-account
     * token, and that stays the more specific answer.
     */
    accessTokenEnc: { type: String, select: false },
    status: { type: String, enum: ['ACTIVE', 'DISABLED'], default: 'ACTIVE', required: true },
  },
  { timestamps: true },
);

// The routing key. Unique across every tenant, for the reason above.
metaAppSchema.index({ webhookRef: 1 }, { unique: true });
// An admin listing their BMs, and the uniqueness that stops the same app
// being added twice to one workspace by mistake.
metaAppSchema.index({ tenantId: 1, appId: 1 }, { unique: true });

export type MetaAppDoc = HydratedDocument<InferSchemaType<typeof metaAppSchema>>;
export const MetaApp = model('MetaApp', metaAppSchema);
