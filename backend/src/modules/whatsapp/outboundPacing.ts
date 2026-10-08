import { getRedisConnection, isRedisConfigured } from '../../queues/connection';
import { logger } from '../../lib/logger';

/**
 * Keeps the automatic private-chat invitation from drowning out everything
 * else a number sends.
 *
 * Meta throttles a WhatsApp number's raw send throughput independently of
 * its daily messaging-limit tier, most strictly on a number still new to
 * the Cloud API — and tightens further once it has seen repeated 130429
 * ("Rate limit hit") rejections rather than easing off. That throttle is
 * invisible everywhere this app looks: health_status reports the number,
 * the WABA, the business and the app all AVAILABLE throughout, because
 * pacing is not a health state Meta surfaces there at all.
 *
 * The automatic invitation (guestAutoReply.service.ts) fires once, inline,
 * for every inbound message on a number that has it turned on — with
 * nothing pacing it. On a number picking up many new conversations at
 * once, that is a burst of sends nothing is waiting on, landing in the
 * same throughput budget as the agent replies and customer messages that
 * matter. This caps the automatic share of that budget so a traffic spike
 * costs the invitation, not the conversation.
 *
 * Counted per WhatsApp number, not per tenant: the throttle this guards
 * against is Meta's, and Meta meters a number, not a workspace.
 */
const WINDOW_SECONDS = 60;

/**
 * Conservative on purpose. The automatic invitation is a convenience — a
 * customer who misses it can still be sent it by an agent, or get it on
 * their next message once the window clears — so understating this number
 * costs a slightly later invitation. Overstating it costs the exact outage
 * this exists to prevent.
 */
const MAX_AUTOMATIC_SENDS_PER_WINDOW = 15;

/**
 * Whether the automatic invitation may send on this number right now.
 *
 * Backed by Redis so the count is shared across every instance actually
 * sending — the whole point, since the throughput cap it is guarding is
 * the number's, not any one process's. Fails open with no counter at all
 * when Redis is not configured (tests, local dev) rather than refuse to
 * send: pacing is a safeguard against an outage, and must never itself
 * become one.
 */
export async function tryReserveAutomaticSendSlot(whatsappPhoneNumberId: string): Promise<boolean> {
  if (!isRedisConfigured()) return true;

  try {
    const redis = getRedisConnection();
    const windowId = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
    const key = `outbound-pacing:auto:${whatsappPhoneNumberId}:${windowId}`;

    const count = await redis.incr(key);
    // Only the first increment in a window sets the expiry; a second
    // expire on every call would be harmless but wasted. Doubled so a
    // slow reader never sees a key vanish mid-window.
    if (count === 1) await redis.expire(key, WINDOW_SECONDS * 2);

    return count <= MAX_AUTOMATIC_SENDS_PER_WINDOW;
  } catch (err) {
    // Same reasoning as the "not configured" case: a pacing check that
    // cannot run must not block a send that would otherwise go through.
    logger.warn({ err, whatsappPhoneNumberId }, 'Could not check automatic-send pacing — sending anyway');
    return true;
  }
}
