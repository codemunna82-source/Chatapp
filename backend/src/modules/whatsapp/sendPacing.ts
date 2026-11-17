import { getRedisConnection, isRedisConfigured } from '../../queues/connection';
import { logger } from '../../lib/logger';
import { createTtlCache } from '../../lib/ttlCache';
import { findPhoneNumberByIdAndTenant } from './whatsapp.repository';

/**
 * The per-number throughput budget every outbound WhatsApp send is paced
 * against — not just the automatic invitation (outboundPacing.ts guards
 * that on its own, smaller, separate budget). This one covers everything
 * that reaches Meta on a number: agent replies, templates, media,
 * location, the invitation, all of it sharing one ceiling, because that
 * is how Meta actually meters it — per number, not per sender or per
 * message type.
 *
 * Meta does not publish an exact messages-per-second figure, and this
 * session's own incident showed why that matters: a brand-new number
 * that sent fine at 10-25/min in the morning was down to single-digit
 * percent success by evening, at the same rate, because Meta's own
 * throttle tightens on repeated violations rather than staying fixed.
 * These numbers are a conservative, documented guess tied to the
 * officially published daily conversation tier — not a number Meta gave
 * us — and are meant to stay well under where trouble starts, not to
 * find the exact edge.
 */
function sendsPerMinuteForTier(tier: string | null | undefined): number {
  switch ((tier ?? '').toUpperCase()) {
    case 'TIER_1K':
      return 20;
    case 'TIER_10K':
      return 40;
    case 'TIER_100K':
      return 80;
    case 'TIER_UNLIMITED':
      return 120;
    case 'TIER_250':
    default:
      // Also what a number with no tier yet reads as — Meta has not
      // assigned one, which in practice means brand new. The incident
      // this exists for was exactly this case.
      return 10;
  }
}

const WINDOW_SECONDS = 60;

/** How long a number's tier is trusted before re-reading it — cheap to
 *  get slightly stale (the tier changes on Meta's own schedule, not
 *  ours), expensive to read on every single send. */
const TIER_CACHE_TTL_MS = 60_000;
const tierCache = createTtlCache<string | undefined>({ ttlMs: TIER_CACHE_TTL_MS, maxEntries: 1000 });

async function currentTier(whatsappPhoneNumberId: string, tenantId: string): Promise<string | undefined> {
  const cached = tierCache.get(whatsappPhoneNumberId);
  if (cached !== undefined) return cached || undefined;
  try {
    const phoneNumber = await findPhoneNumberByIdAndTenant(whatsappPhoneNumberId, tenantId);
    const tier = phoneNumber?.messagingLimitTier ?? undefined;
    tierCache.set(whatsappPhoneNumberId, tier ?? '');
    return tier;
  } catch (err) {
    logger.warn({ err, whatsappPhoneNumberId }, 'Could not read messaging tier for send pacing — using the conservative default');
    return undefined;
  }
}

/**
 * Whether a WhatsApp send to this number may go out to Meta right now.
 *
 * Backed by Redis so the count is shared across every process actually
 * sending — the same reasoning as outboundPacing.ts. Fails OPEN with no
 * Redis configured or on any Redis error: a pacing check that cannot run
 * must never be the reason a real message does not go out. The risk this
 * guards against (an avoidable rate-limit storm) is strictly worse with
 * pacing silently disabled than with it occasionally too permissive, but
 * neither should ever mean "refuse to send."
 */
export async function trySlotForDispatch(whatsappPhoneNumberId: string, tenantId: string): Promise<boolean> {
  if (!isRedisConfigured()) return true;

  try {
    const limit = sendsPerMinuteForTier(await currentTier(whatsappPhoneNumberId, tenantId));
    const redis = getRedisConnection();
    const windowId = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
    const key = `outbound-pacing:dispatch:${whatsappPhoneNumberId}:${windowId}`;

    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, WINDOW_SECONDS * 2);

    return count <= limit;
  } catch (err) {
    logger.warn({ err, whatsappPhoneNumberId }, 'Could not check dispatch pacing — sending anyway');
    return true;
  }
}

/** Test seam. */
export function resetSendPacingTierCache(): void {
  tierCache.clear();
}
