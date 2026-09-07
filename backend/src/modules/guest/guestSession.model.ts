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
    /** Who generated the link — an audit trail for "who gave this out". */
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    expiresAt: { type: Date, required: true },
    /** Set when an agent revokes the link; a revoked session is never resurrected. */
    revokedAt: { type: Date },
    /** Last time the customer actually used the link, for support questions about whether they ever opened it. */
    lastSeenAt: { type: Date },
  },
  { timestamps: true },
);

// The lookup every single guest request makes, on a value that must
// identify exactly one session.
guestSessionSchema.index({ tokenHash: 1 }, { unique: true });
// Finding the live link for a conversation, so re-sending "Open private
// chat" hands out the link the customer may already have rather than
// silently invalidating the one sitting in their WhatsApp thread.
guestSessionSchema.index({ conversationId: 1, expiresAt: -1 });

type GuestSessionAttrs = InferSchemaType<typeof guestSessionSchema> & Timestamps;
export type GuestSessionDoc = HydratedDocument<GuestSessionAttrs>;
export type GuestSessionLean = Lean<GuestSessionAttrs>;
export const GuestSession = model('GuestSession', guestSessionSchema);
