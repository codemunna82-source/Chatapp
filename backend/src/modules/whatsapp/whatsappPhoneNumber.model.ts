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
     * The business display name Meta holds for this number — the name a
     * customer sees above the chat in WhatsApp itself.
     *
     * Stored because it is the only name in the system the customer has
     * already seen. The workspace's own `Tenant.name` is an internal
     * label (a fresh install's is literally "Demo Tenant"), and showing
     * that to a customer in the web window makes the window look like it
     * belongs to someone else — which, for a page asking them to keep
     * talking, is the one impression it cannot afford.
     *
     * Read back from Meta on every health refresh, never set by hand, for
     * the same reason `nameStatus` is not: it is Meta's record of what
     * this number is called, not ours.
     */
    verifiedName: { type: String },
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
     * Meta's own live verdict on the number, read back on the same refresh
     * as the quality rating — CONNECTED, FLAGGED, RESTRICTED, BANNED,
     * RATE_LIMITED, and whatever else Meta reports. Free text rather than
     * an enum: Meta's own set of values is not fixed, and rejecting a
     * status it hands back would be worse than storing one we do not yet
     * have a label for.
     *
     * Deliberately separate from `status` below, which is this app's OWN
     * record of whether the number has completed Cloud API registration
     * and is set once, at registration, never again from Meta. Two
     * different authorities, two fields, same pattern as `enabled` and
     * `accountStatus` elsewhere on this document: a number can read
     * `status: CONNECTED` (we registered it) while `metaStatus: BANNED`
     * (Meta has since banned it) — collapsing the two would hide exactly
     * that case.
     */
    metaStatus: { type: String },
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
    /**
     * The admin's own switch: whether the people assigned to this number
     * may use it at all.
     *
     * Deliberately NOT folded into `status`. That field is Meta's verdict
     * on the number — PENDING, CONNECTED, RESTRICTED — and overloading it
     * with a local decision would mean the next health refresh from Meta
     * silently switched a member's access back on. Two different
     * authorities, two fields.
     *
     * Default true so every number that already exists stays exactly as
     * it is: this is an off switch nobody has pressed, not a new gate
     * every number has to pass.
     */
    enabled: { type: Boolean, default: true },
    /**
     * Whether Meta has voice calling switched on for this number —
     * ENABLED or DISABLED, as Meta reports it.
     *
     * Calling is OFF by default on every number, including test ones. A
     * number that messages perfectly will never ring, and nothing about
     * its status hints at why, so this is stored purely so the admin
     * screen can say which it is instead of leaving someone to guess.
     *
     * Meta's word, read back on the same refresh as the quality rating —
     * never set from the switch itself, or turning it on here would claim
     * a state Meta had not confirmed.
     */
    callingStatus: { type: String },
    /**
     * A key an external automation (WhatsApp Flows, a BSP's chatbot
     * builder) presents to fetch a fresh private-chat link for a customer
     * by phone number — see guestLinkApi.routes.ts.
     *
     * Hashed, never the plaintext: the key is shown to the admin exactly
     * once, at generation, the same way a guest session's own token is.
     * select: false for the same reason the Meta secrets above are — it
     * has no business coming back on an ordinary read.
     */
    linkApiKeyHash: { type: String, select: false },
    /** When the current key was generated, so the admin screen can show it without ever showing the key itself again. */
    linkApiKeyCreatedAt: { type: Date },
  },
  { timestamps: true },
);

// The single most important index in this collection: every inbound Meta
// webhook carries phone_number_id and nothing else identifying tenancy —
// this is how the webhook handler resolves which tenant an event belongs to.
whatsappPhoneNumberSchema.index({ phoneNumberId: 1 }, { unique: true });
whatsappPhoneNumberSchema.index({ ownerUserId: 1 });
// Sparse: most numbers never generate this key, and a plain unique index
// would let only one of them have no key at all.
whatsappPhoneNumberSchema.index(
  { linkApiKeyHash: 1 },
  { unique: true, sparse: true },
);

export type WhatsAppPhoneNumberDoc = HydratedDocument<InferSchemaType<typeof whatsappPhoneNumberSchema>>;
export const WhatsAppPhoneNumber = model('WhatsAppPhoneNumber', whatsappPhoneNumberSchema);
