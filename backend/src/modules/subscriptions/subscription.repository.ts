import { Subscription, type SubscriptionDoc } from './subscription.model';
import { computeSubscriptionStatus } from '../users/user.model';

export interface CreateSubscriptionInput {
  tenantId: string;
  plan: string;
  validFrom: Date;
  validUntil: Date;
  autoRenew?: boolean;
}

export async function createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionDoc> {
  return Subscription.create({ ...input, status: 'ACTIVE' });
}

/** The tenant's current (most recently created) subscription record. */
export async function getCurrentSubscription(tenantId: string): Promise<SubscriptionDoc | null> {
  return Subscription.findOne({ tenantId }).sort({ createdAt: -1 });
}

export async function extendSubscriptionValidity(
  tenantId: string,
  id: string,
  newValidUntil: Date,
): Promise<SubscriptionDoc | null> {
  return Subscription.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: { validUntil: newValidUntil } },
    { new: true },
  );
}

/** Live status — same authoritative pattern as User's computeSubscriptionStatus, never a stale cache. */
export function computeCurrentStatus(sub: Pick<SubscriptionDoc, 'validFrom' | 'validUntil' | 'status'>) {
  const disabledEquivalent = sub.status === 'SUSPENDED' ? 'DISABLED' : 'ACTIVE';
  return computeSubscriptionStatus(sub.validFrom, sub.validUntil, disabledEquivalent);
}
