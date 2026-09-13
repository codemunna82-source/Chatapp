import { env } from '../../config/env';

/**
 * The furthest-future date this system treats as "no expiry".
 *
 * A real date rather than a null, because `expiresAt` is required on the
 * model and every lookup filters on `$gt: new Date()`. Making it nullable
 * would mean teaching each of those queries about a second case — and the
 * one that got missed would silently reject a link that should work.
 *
 * Year 9999: beyond any plausible life of the business, and it reads as
 * deliberate rather than as a date someone fat-fingered.
 */
const NEVER = new Date('9999-12-31T23:59:59.000Z');

/**
 * When a newly issued web-chat link should stop working.
 *
 * GUEST_SESSION_TTL_DAYS = 0 means never. Every caller goes through this
 * rather than doing the arithmetic itself: the two that did were the two
 * that would have had to learn about 0 separately, and a link that
 * expires because one of them was missed looks to the customer exactly
 * like the bug this was written alongside.
 */
export function guestSessionExpiresAt(now: Date = new Date()): Date {
  const days = env.GUEST_SESSION_TTL_DAYS;
  if (days <= 0) return NEVER;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Whether a session's expiry is the "never" sentinel, for the UI to say so. */
export function isNonExpiring(expiresAt: Date): boolean {
  return expiresAt.getTime() === NEVER.getTime();
}
