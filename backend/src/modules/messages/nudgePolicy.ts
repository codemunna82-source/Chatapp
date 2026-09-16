import { createTtlCache } from '../../lib/ttlCache';
import { logger } from '../../lib/logger';
import { Tenant } from '../tenants/tenant.model';
import { WHATSAPP_NUDGE_LIMIT } from './whatsappQuota';
import { nudgesFor } from './nudgeTemplates';

/**
 * A workspace's rule for WhatsApp messages sent before the customer has
 * opened their private chat.
 *
 * Read on every WhatsApp send, so it is cached — briefly, because an
 * admin who changes the wording expects the next message to use it, and
 * because the value is three fields that are cheap to recompute.
 */
export interface NudgePolicy {
  /** Only the listed wording may be sent, in order. */
  enforced: boolean;
  /** The wording, in the order it is sent. */
  nudges: string[];
  /**
   * How many WhatsApp messages are allowed in total.
   *
   * The LIST LENGTH when enforcement is on, because "these are the
   * messages" and "this many messages" are then the same statement — two
   * separate numbers could disagree, and the one that lost would be a
   * silent surprise on whichever side an admin was not looking at.
   * With enforcement off there is no list to count, so the plain
   * allowance applies.
   */
  limit: number;
}

const TTL_MS = 30_000;
const cache = createTtlCache<NudgePolicy>({ ttlMs: TTL_MS, maxEntries: 500 });

export async function nudgePolicyFor(tenantId: string): Promise<NudgePolicy> {
  const key = String(tenantId);
  const hit = cache.get(key);
  if (hit) return hit;

  let policy: NudgePolicy = { enforced: true, nudges: nudgesFor(null), limit: nudgesFor(null).length };
  try {
    const tenant = await Tenant.findById(key, { whatsappNudges: 1 }).lean();
    const enforced = tenant?.whatsappNudges?.enforced !== false;
    const nudges = nudgesFor(tenant?.whatsappNudges?.messages);
    policy = { enforced, nudges, limit: enforced ? nudges.length : WHATSAPP_NUDGE_LIMIT };
  } catch (error) {
    // The defaults are a safe answer: they are the STRICTER one, so a
    // database blip cannot widen what may be sent to a customer.
    logger.error({ err: error, tenantId: key }, 'Could not read the WhatsApp nudge policy; using defaults');
  }

  cache.set(key, policy);
  return policy;
}

/** Drop a workspace's cached policy, after an admin changes it. */
export function forgetNudgePolicy(tenantId: string): void {
  cache.delete(String(tenantId));
}

/** Test seam. */
export function resetNudgePolicyCache(): void {
  cache.clear();
}
