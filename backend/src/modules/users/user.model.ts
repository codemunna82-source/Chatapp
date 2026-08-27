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
