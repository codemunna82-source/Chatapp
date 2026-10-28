import { createTtlCache } from '../../lib/ttlCache';
import { logger } from '../../lib/logger';
import { env } from '../../config/env';
import { Tenant } from './tenant.model';

/**
 * Whether this workspace's replies go over WhatsApp, or into the
 * customer's private chat.
 *
 * META_ON_HOLD already decided this, and decided it for the whole server
 * at deploy time. That was right while there was one business running one
 * way: WhatsApp broke, everything moved to SMS and the private chat, and
 * an environment variable turned it off in one move.
 *
 * It is wrong as soon as the choice belongs to the business rather than
 * to the deploy. Changing it means an environment variable and a restart,
 * nobody but whoever holds the Render dashboard can do it, and every
 * workspace on the server is switched at once — including ones whose
 * WhatsApp is working perfectly.
 *
 * So the workspace's own setting wins, and the environment variable is
 * what a workspace that has never touched the switch falls back to.
 * Nothing changes for an existing deployment until someone moves it.
 */

/** Short, because an admin flipping the switch expects the next message to obey it. */
const TTL_MS = 30_000;
const cache = createTtlCache<boolean>({ ttlMs: TTL_MS, maxEntries: 500 });

/**
 * The stored value, resolved against the server default.
 *
 * Pure, so the rule can be tested without a database: unset means "follow
 * the server", and only an explicit true or false on the workspace
 * overrides it. The distinction matters — `false` is a workspace that has
 * deliberately turned WhatsApp back on, and it must not be read as "no
 * preference" on a server where the hold is on.
 */
export function resolveMetaHold(stored: boolean | null | undefined, serverDefault: boolean): boolean {
  return typeof stored === 'boolean' ? stored : serverDefault;
}

/**
 * Is WhatsApp on hold for this workspace right now?
 *
 * Falls back to the server default on any read failure rather than
 * throwing. This is consulted on every send, and a database blip must not
 * turn into an outage on a path that has a perfectly good answer already.
 */
export async function isMetaOnHold(tenantId: string): Promise<boolean> {
  const key = String(tenantId);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let onHold = env.META_ON_HOLD;
  try {
    const tenant = await Tenant.findById(key, { metaOnHold: 1 }).lean();
    onHold = resolveMetaHold(tenant?.metaOnHold, env.META_ON_HOLD);
  } catch (error) {
    logger.error({ err: error, tenantId: key }, 'Could not read the WhatsApp hold setting; using the server default');
  }

  cache.set(key, onHold);
  return onHold;
}

/** Drop a workspace's cached value, after an admin moves the switch. */
export function forgetMetaHold(tenantId: string): void {
  cache.delete(String(tenantId));
}

/** Test seam. */
export function resetMetaHoldCache(): void {
  cache.clear();
}
