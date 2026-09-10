import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import type { Lean } from '../../lib/modelTypes';

/**
 * One browser's Web Push registration for one chat link.
 *
 * Kept apart from DeviceToken rather than folded into it. That collection
 * requires a userId, and the whole point of a guest is that there is no
 * user — a customer holding a link has no account to hang a device off.
 * Bolting an optional userId onto it would put "which of these rows is a
 * real signed-in device" into every query that fans a notification out to
 * a workspace, which is exactly the query that must never be wrong: it is
 * the one that decides whose lock screen a customer's message appears on.
 *
 * Keyed on the token, like DeviceToken, because the token IS the browser.
 * The same browser re-registering re-points the row at whichever session
 * it is now holding instead of leaving a second row that would keep
 * pushing a conversation the customer has moved on from.
 */
const guestPushTokenSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    guestSessionId: { type: Schema.Types.ObjectId, ref: 'GuestSession', required: true, index: true },
    /** The FCM registration token this browser was issued. */
    token: { type: String, required: true },
    /**
     * Bumped every time the window registers, which is every load. A token
     * nobody has refreshed in months belongs to a browser that has not
     * opened this chat since — and the link it was issued against has very
     * likely expired anyway.
     */
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// The token is the identity — see above.
guestPushTokenSchema.index({ token: 1 }, { unique: true });
// The send-side query: every browser still listening to this conversation.
guestPushTokenSchema.index({ conversationId: 1, tenantId: 1 });

type GuestPushTokenAttrs = InferSchemaType<typeof guestPushTokenSchema> & { createdAt: Date; updatedAt: Date };
export type GuestPushTokenDoc = HydratedDocument<GuestPushTokenAttrs>;
export type GuestPushTokenLean = Lean<GuestPushTokenAttrs>;
export const GuestPushToken = model('GuestPushToken', guestPushTokenSchema);
