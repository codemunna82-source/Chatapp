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
 * Two things are outside it, and each for its own reason:
 *
 * - A demo contact. The number is not on WhatsApp at all — those chats
 *   run against the mock gateway, and a limit on an imaginary cost is
 *   just a broken sandbox.
 * - A reaction. It is not a message, it does not open a conversation with
 *   Meta, and a thumbs-up should not spend the reply someone needs.
 *
 * A customer who wrote to us within the last 24 hours is deliberately
 * NOT outside it, even though Meta itself would allow a free-form reply
 * in that window. An earlier version of this exempted that case — reasoning
 * that refusing a plain reply to someone who had just messaged read as a
 * bug — and it was: the exemption fixed that, but it also meant every
 * inbound message reopened unlimited free-form WhatsApp replies for as
 * long as the customer kept writing, which is exactly the volume this
 * allowance exists to cap. A workspace with many new conversations a day
 * (the common case this guards) could run a normal back-and-forth with
 * every one of them on WhatsApp itself and never be pushed toward the
 * private link at all — and Meta's own throughput throttle (130429) does
 * not care that the content was legitimate, only that a lot of it went
 * out fast. The fix for "an agent cannot answer a customer who just
 * wrote in" is the private chat link, not an unlimited WhatsApp channel.
 *
 * An approved template and the automatic private-chat invitation are
 * also NOT outside it. Both are a real send to a customer who has not
 * engaged, which is the exact thing the allowance exists to budget;
 * `internal` only ever meant "hide this bubble from the agent's thread"
 * (message.model.ts), never "free of charge". The invitation IS allowed
 * to skip the exact-wording check that applies to an ordinary nudge
 * while enforcement is on — see `exemptFromNudgeWording` in
 * message.service.ts — because its own text carries the link and is an
 * admin setting of its own; what it cannot skip is the count.
 */
export function countsAgainstNudgeQuota(input: { messageType: string; isDemoContact: boolean }): boolean {
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
