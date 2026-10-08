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
export const WHATSAPP_NUDGE_LIMIT = 2;

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
 * - A customer who wrote to us within the last 24 hours. This is the big
 *   one, and leaving it out was the bug: the allowance is for customers
 *   who have NOT engaged, but the only sends that ever reached this check
 *   were the ones Meta's 24-hour window had already let through — so a
 *   plain reply to a customer who had just messaged was refused as if it
 *   were an unsolicited nudge, on every number and every business
 *   account. Inside that window Meta itself allows a free-form reply, and
 *   so do we.
 * - A demo contact. The number is not on WhatsApp at all — those chats
 *   run against the mock gateway, and a limit on an imaginary cost is
 *   just a broken sandbox.
 * - A reaction. It is not a message, it does not open a conversation with
 *   Meta, and a thumbs-up should not spend the reply someone needs.
 *
 * An approved template is NOT outside it, and neither — since this was
 * changed — is the automatic private-chat invitation. Both are a real
 * send to a customer who has not engaged, which is the exact thing the
 * allowance exists to budget; `internal` only ever meant "hide this
 * bubble from the agent's thread" (message.model.ts), never "free of
 * charge". The invitation IS allowed to skip the exact-wording check
 * that applies to an ordinary nudge while enforcement is on — see
 * `exemptFromNudgeWording` in message.service.ts — because its own text
 * carries the link and is an admin setting of its own; what it cannot
 * skip is the count.
 */
export function countsAgainstNudgeQuota(input: {
  messageType: string;
  isDemoContact: boolean;
  /**
   * Whether Meta's 24-hour customer-service window is open — which is
   * only ever true because the customer messaged us inside it, since that
   * is the single thing that opens it (conversation.repository.ts).
   *
   * Required rather than optional: a caller that forgets it would get the
   * old behaviour back, and the old behaviour was an inbox that could not
   * reply.
   */
  withinCustomerServiceWindow: boolean;
}): boolean {
  if (input.withinCustomerServiceWindow) return false;
  if (input.isDemoContact) return false;
  if (input.messageType === 'reaction') return false;
  return true;
}

/** How many are left, never negative. */
export function nudgesLeft(used: number, limit: number = WHATSAPP_NUDGE_LIMIT): number {
  return Math.max(0, limit - used);
}

/**
 * What the agent is told when the allowance is gone.
 *
 * Says what happened, why, and what makes it work again — in that order,
 * because "send them the private chat link" is the only thing they can
 * act on and a message that buries it reads as an outage.
 *
 * Takes the limit rather than baking it in: with the wording enforced,
 * the allowance is however many messages the workspace has set, so a
 * fixed number here would be wrong for any workspace that changed it.
 */
export function nudgeQuotaMessage(limit: number = WHATSAPP_NUDGE_LIMIT): string {
  return (
    `Only ${limit} WhatsApp ${limit === 1 ? 'reply is' : 'replies are'} allowed until this customer opens ` +
    'their private chat. Send them the private chat link — once they open it you can message them ' +
    'without any limit.'
  );
}

/** The default-limit wording, for callers with no workspace in hand. */
export const NUDGE_QUOTA_MESSAGE = nudgeQuotaMessage();
