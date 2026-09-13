import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import type { Timestamps, Lean } from '../../lib/modelTypes';

/**
 * One customer's access to one conversation through the web chat window.
 *
 * The link this backs is pasted into a WhatsApp thread and stays there
 * forever, so the token behind it is deliberately NOT a JWT: a JWT is
 * valid until it expires and there is no way to take it back, and "the
 * customer forwarded the chat link to someone else" has to be answerable
 * with a revoke rather than a shrug. An opaque random token checked
 * against this collection can be revoked the moment it needs to be.
 *
 * Only the SHA-256 of the token is stored. A database dump is then a list
 * of useless hashes rather than a working key to every customer
 * conversation in the workspace — the same reasoning as password storage,
 * minus the need for a slow KDF, because a 256-bit random token has no
 * guessable structure to attack.
 */
const guestSessionSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true },
    /**
     * Carried on the session itself rather than read from the conversation
     * on each request. It is what every emit and every push is addressed
     * by, so a guest request would otherwise load the conversation purely
     * to re-derive a value that cannot change for the life of the session.
     */
    whatsappPhoneNumberId: { type: Schema.Types.ObjectId, ref: 'WhatsAppPhoneNumber', required: true },
    /** SHA-256 hex of the token. The token itself is returned once, at creation, and never stored. */
    tokenHash: { type: String, required: true },
    /**
     * Every token ever issued for this session, as hashes — the newest
     * last.
     *
     * A session used to hold exactly one hash, and re-sending the
     * invitation OVERWROTE it. The code even said it was re-sending the
     * same link; it was not. Every copy already sitting in the customer's
     * WhatsApp thread became a dead link the moment a new one went out,
     * and tapping one showed "This chat link has expired" for a link
     * minted minutes earlier.
     *
     * The hash-only storage is what forced it: the token itself is
     * returned once and never kept, so the old URL cannot be re-sent —
     * only a new one can be minted. Keeping every hash valid resolves
     * that without giving the property up: a database dump is still a
     * list of useless hashes, and every link the customer was ever sent
     * still opens their conversation.
     */
    tokenHashes: { type: [String], default: undefined },
    /** Who generated the link — an audit trail for "who gave this out". */
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    expiresAt: { type: Date, required: true },
    /** Set when an agent revokes the link; a revoked session is never resurrected. */
    revokedAt: { type: Date },
    /** Last time the customer actually used the link, for support questions about whether they ever opened it. */
    lastSeenAt: { type: Date },
    /**
     * Set when the CUSTOMER blocks the business from this window.
     *
     * Deliberately not `revokedAt`. Revoking is the agent taking the link
     * back and is final — the token is gone and the customer has no way to
     * undo it. Blocking is the customer's own choice about a link they are
     * still holding, and in every messenger they have used it is a switch,
     * not a demolition. So the session stays resolvable: the window still
     * loads, still shows the history, and still offers Unblock. What the
     * flag changes is that neither side may write while it is set.
     */
    blockedAt: { type: Date },
    /**
     * How many times the invitation has been sent into the WhatsApp thread.
     *
     * Counted rather than inferred from "does a session exist", because
     * the invitation is deliberately sent more than once: a customer who
     * writes again without having tapped the link has almost certainly not
     * seen it, and one more is worth sending. Bounded by the workspace's
     * maxSends so "more than once" never becomes "every time", which is
     * what a customer experiences as spam.
     */
    invitesSent: { type: Number, default: 0, required: true },
    /**
     * When the customer first USED the window — not merely opened it.
     *
     * The moment this is set, two things stop: the invitation is no longer
     * re-sent, and held WhatsApp messages are released to the agents. It
     * is the one signal that the customer has actually moved over, which
     * is what every rule here is waiting for.
     */
    activatedAt: { type: Date },
  },
  { timestamps: true },
);

// The lookup every single guest request makes, on a value that must
// identify exactly one session.
guestSessionSchema.index({ tokenHash: 1 }, { unique: true });
// The lookup path for every guest request. Not unique: a hash appears in
// exactly one session's array anyway (the tokens are 256-bit random), and
// declaring uniqueness on a multikey index would reject a session whose
// array happened to be built in two steps.
guestSessionSchema.index({ tokenHashes: 1 });
// Finding the live link for a conversation, so re-sending "Open private
// chat" hands out the link the customer may already have rather than
// silently invalidating the one sitting in their WhatsApp thread.
guestSessionSchema.index({ conversationId: 1, expiresAt: -1 });

type GuestSessionAttrs = InferSchemaType<typeof guestSessionSchema> & Timestamps;
export type GuestSessionDoc = HydratedDocument<GuestSessionAttrs>;
export type GuestSessionLean = Lean<GuestSessionAttrs>;
export const GuestSession = model('GuestSession', guestSessionSchema);
