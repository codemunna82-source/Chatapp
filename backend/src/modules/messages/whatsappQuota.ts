import type { GuestSessionDoc } from '../guest/guestSession.model';

/**
 * How many WhatsApp replies an agent gets while the customer is NOT in
 * the private chat window.
 *
 * The private window is this app's own channel: free, instant, and with
 * none of Meta's rules on it, so a conversation that has moved there is
 * unlimited. WhatsApp is neither — every message is Meta's to price and
 * to rate-limit, and a workspace that simply keeps typing into WhatsApp
 * never gets the customer across.
 *
 * So the WhatsApp side is a NUDGE allowance, not a conversation: enough
 * to say "we have replied, here is the link" a couple of times over, and
 * then it stops. The moment the customer opens their window the cap is
 * irrelevant — replies route there instead (webChatRouting.ts) and there
 * is no limit at all.
 *
 * Deliberately a hard stop rather than a warning. A cap that can be
 * talked past is a cap nobody plans around, and the whole point is that
 * the private link is the way through.
 */
export const WHATSAPP_NUDGE_LIMIT = 3;

/**
 * When the allowance last restarted.
 *
 * The customer's last visit to the private window — because the cap is
 * about ONE stretch of them not being there. Someone who opened the
 * window, talked, and drifted off weeks later is not the same case as
 * someone who never opened it at all, and giving the first a fresh three
 * nudges is exactly right: it is the same "come back" the first three
 * were for.
 *
 * Null when they have never opened it, which means count the whole
 * conversation.
 */
export function nudgeWindowStart(
  session: Pick<GuestSessionDoc, 'activatedAt' | 'lastSeenAt'> | null,
): Date | null {
  if (!session) return null;
  // lastSeenAt is written on every authenticated guest request, so it is
  // the later of the two whenever both exist.
  return session.lastSeenAt ?? session.activatedAt ?? null;
}

/**
 * Whether this particular send is one the allowance governs.
 *
 * Three things are outside it, and each for its own reason:
 *
 * - The private-chat INVITATION. It is the way out of the cap; capping it
 *   would trap a customer who has not opened their link with no way left
 *   to be sent one. It is `internal` and never appears in the agent's
 *   thread either.
 * - A demo contact. The number is not on WhatsApp at all — those chats
 *   run against the mock gateway, and a limit on an imaginary cost is
 *   just a broken sandbox.
 * - A reaction. It is not a message, it does not open a conversation with
 *   Meta, and a thumbs-up should not spend the reply someone needs.
 */
export function countsAgainstNudgeQuota(input: {
  messageType: string;
  internal?: boolean;
  isDemoContact: boolean;
}): boolean {
  if (input.internal) return false;
  if (input.isDemoContact) return false;
  if (input.messageType === 'reaction') return false;
  return true;
}

/** How many are left, never negative. */
export function nudgesLeft(used: number): number {
  return Math.max(0, WHATSAPP_NUDGE_LIMIT - used);
}

/**
 * What the agent is told when the allowance is gone.
 *
 * Says what happened, why, and what makes it work again — in that order,
 * because "send them the private chat link" is the only thing they can
 * act on and a message that buries it reads as an outage.
 */
export const NUDGE_QUOTA_MESSAGE =
  `Only ${WHATSAPP_NUDGE_LIMIT} WhatsApp replies are allowed until this customer opens their private chat. ` +
  'Send them the private chat link — once they open it you can message them without any limit.';
