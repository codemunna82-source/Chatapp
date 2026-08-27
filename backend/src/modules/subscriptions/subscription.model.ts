import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { SUBSCRIPTION_STATUSES, type SubscriptionStatusLabel } from '../users/user.model';

/**
 * Tenant-level plan/billing record — distinct from a per-User validity
 * window (User.validFrom/validUntil gates an individual sub-user's access;
 * this gates the tenant's plan as a whole, shown on the dashboard/settings
 * screens per spec §25/§26). One active row per tenant.
 */
const subscriptionSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    plan: { type: String, required: true },
    validFrom: { type: Date, required: true },
    validUntil: { type: Date, required: true },
    status: { type: String, enum: SUBSCRIPTION_STATUSES, default: 'ACTIVE', required: true },
    autoRenew: { type: Boolean, default: false },
  },
  { timestamps: true },
);

subscriptionSchema.index({ tenantId: 1, createdAt: -1 });

export type SubscriptionDoc = HydratedDocument<InferSchemaType<typeof subscriptionSchema>>;
export const Subscription = model('Subscription', subscriptionSchema);
export type { SubscriptionStatusLabel };
