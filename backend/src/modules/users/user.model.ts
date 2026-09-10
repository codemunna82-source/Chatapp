import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { PERMISSIONS, type Permission } from './permission';

export const USER_ROLES = ['MASTER_ADMIN', 'SUB_USER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Cached label only — never trust this for access control. See computeSubscriptionStatus(). */
export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'EXPIRING', 'EXPIRED', 'SUSPENDED'] as const;
export type SubscriptionStatusLabel = (typeof SUBSCRIPTION_STATUSES)[number];

const userSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    /**
     * The number this person signs in with, in canonical E.164.
     *
     * Optional on the schema even though every new account gets one, and
     * that is deliberate: it was added after accounts already existed, and
     * a required field would have made every one of them unsaveable —
     * including the MASTER_ADMIN who is the only person able to set the
     * missing values. Login therefore accepts either this or the email,
     * which is what keeps that from being a lockout with no way out.
     *
     * Always stored through normalizePhone, so "+91 98765-43210",
     * "0091…" and the bare digits are one value rather than three
     * accounts.
     */
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: USER_ROLES, required: true },
    permissions: {
      type: [{ type: String, enum: PERMISSIONS }],
      default: [],
    },
    status: { type: String, enum: USER_STATUSES, default: 'ACTIVE', required: true },
    validFrom: { type: Date, required: true, default: () => new Date() },
    validUntil: { type: Date, required: true },
    lastLoginAt: { type: Date },
    displayName: { type: String, trim: true },
    /**
     * Which of the tenant's WhatsApp numbers this user sends from.
     *
     * A reference into WhatsAppPhoneNumber rather than a raw Meta
     * `phone_number_id` string, deliberately: the raw id carries no tenancy,
     * so storing one here would let a mistyped or forged value point at
     * another tenant's number and send through it. An ObjectId is checked
     * against `{ _id, tenantId }` before it is ever written (see
     * assertPhoneNumberBelongsToTenant in user.service.ts) and re-checked
     * when a conversation is opened.
     *
     * Optional: users without an assignment fall back to the tenant's first
     * connected number, which is exactly what every existing user did
     * before this field existed.
     */
    whatsappPhoneNumberId: { type: Schema.Types.ObjectId, ref: 'WhatsAppPhoneNumber' },
    // Cloudinary-hosted (see integrations/cloudinary.ts) — the bytes
    // themselves are never stored inline on this document. avatarUrl is
    // select: false anyway (only the dedicated GET .../avatar route needs
    // it) so it's never handed to a client directly; that route fetches
    // the bytes from Cloudinary server-side and proxies them, same
    // access-token/URL boundary as the WhatsApp media proxy.
    avatarUrl: { type: String, select: false },
    avatarContentType: { type: String, select: false },
    avatarCloudinaryPublicId: { type: String, select: false },
    avatarUpdatedAt: { type: Date },
  },
  { timestamps: true },
);

// Both sign-in identifiers are globally unique across the platform, not
// just per-tenant: a User document belongs to exactly one tenant, and
// POST /api/auth/login takes one identifier and a password with no tenant
// selector — so the lookup must resolve to a single account without any
// prior tenant context. Two workspaces holding the same phone number would
// make "who is this" ambiguous at the moment it has to be certain.
userSchema.index({ email: 1 }, { unique: true });
// Partial rather than sparse. A sparse unique index still indexes an
// explicit null, so two accounts saved with `phone: null` — which is what
// a form submitting an empty field produces — would collide with each
// other and the second would be rejected as a duplicate phone number
// nobody entered. Restricting the index to actual strings sidesteps it.
userSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string' } } },
);
userSchema.index({ tenantId: 1, status: 1 });

/**
 * Authoritative, live subscription-window check. This is what every
 * middleware call MUST use — never a cached/denormalized field — because a
 * delayed background sweep must never grant access past expiry.
 */
export function computeSubscriptionStatus(
  validFrom: Date,
  validUntil: Date,
  status: UserStatus,
  now: Date = new Date(),
): SubscriptionStatusLabel {
  if (status === 'DISABLED') return 'SUSPENDED';
  if (now < validFrom || now > validUntil) return 'EXPIRED';
  const msRemaining = validUntil.getTime() - now.getTime();
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  if (msRemaining <= threeDaysMs) return 'EXPIRING';
  return 'ACTIVE';
}

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;
export const User = model('User', userSchema);

export type { Permission };
