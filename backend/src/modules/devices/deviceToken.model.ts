import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const DEVICE_PLATFORMS = ['android', 'ios'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/**
 * One FCM registration token per app install.
 *
 * Keyed on the token rather than on the user: a token belongs to an
 * install, and the same phone can be signed into a different account
 * tomorrow. Re-registering an existing token therefore re-points it at the
 * current user instead of creating a second row — otherwise the previous
 * user would keep receiving this device's notifications.
 */
const deviceTokenSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token: { type: String, required: true },
    platform: { type: String, enum: DEVICE_PLATFORMS, required: true },
    /**
     * Bumped on every registration. FCM tokens rotate and installs go away
     * silently, so a token nobody has refreshed in months is almost
     * certainly dead weight — this is what makes pruning possible without
     * waiting for a send to fail.
     */
    lastSeenAt: { type: Date, default: Date.now },
    /**
     * The Android notification channel this install wants ringing calls on.
     *
     * Stored per DEVICE because that is where the choice lives: a channel's
     * sound is fixed the moment Android creates it, so "use a different
     * ringtone" can only ever mean "use a different channel", and which
     * channel exists is a fact about one phone.
     *
     * Absent for iOS, for the web, and for any Android build older than the
     * picker — push.service falls back to the default channel for those,
     * which is the one every such install already has.
     */
    callChannelId: { type: String },
  },
  { timestamps: true },
);

// The token IS the identity — see the note above.
deviceTokenSchema.index({ token: 1 }, { unique: true });
// Fan-out query: every device belonging to a tenant's users.
deviceTokenSchema.index({ tenantId: 1, userId: 1 });

export type DeviceTokenDoc = HydratedDocument<InferSchemaType<typeof deviceTokenSchema>>;
export const DeviceToken = model('DeviceToken', deviceTokenSchema);
