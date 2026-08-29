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

// Email is globally unique across the platform, not just per-tenant: a
// User document belongs to exactly one tenant, and POST /api/auth/login
// takes only { email, password } with no tenant selector — the login
// lookup must resolve to a single account without prior tenant context.
userSchema.index({ email: 1 }, { unique: true });
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
