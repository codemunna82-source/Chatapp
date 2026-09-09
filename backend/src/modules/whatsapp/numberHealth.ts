/**
 * What a quality rating actually means for the person reading it.
 *
 * "YELLOW" on a settings screen tells an operator nothing they can act on.
 * The point of surfacing this at all is to catch the drop *before* Meta
 * restricts the number, so the rating is translated into what has
 * happened and what to do about it.
 *
 * Pure, and tested as such: it is the difference between a warning that
 * works and a coloured dot.
 */

export type HealthLevel = 'ok' | 'warn' | 'critical' | 'unknown';

export interface NumberHealth {
  level: HealthLevel;
  headline: string;
  detail: string;
  /** True when the reading is old enough that it should not be trusted on its own. */
  stale: boolean;
}

/** Beyond this, a reading is old enough to say so rather than present it as current. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** Meta's tiers, smallest first — a drop between readings is itself a warning. */
export const MESSAGING_TIERS = ['TIER_250', 'TIER_1K', 'TIER_10K', 'TIER_100K', 'TIER_UNLIMITED'] as const;

export function describeNumberHealth(input: {
  qualityRating?: string;
  messagingLimitTier?: string;
  healthCheckedAt?: Date | string;
  now?: Date;
}): NumberHealth {
  const now = input.now ?? new Date();
  const checkedAt = input.healthCheckedAt ? new Date(input.healthCheckedAt) : undefined;
  const stale = !checkedAt || now.getTime() - checkedAt.getTime() > STALE_AFTER_MS;

  const rating = (input.qualityRating ?? '').toUpperCase();
  const tier = input.messagingLimitTier ? ` Current limit: ${friendlyTier(input.messagingLimitTier)}.` : '';

  switch (rating) {
    case 'GREEN':
      return {
        level: 'ok',
        headline: 'Quality is good',
        detail: `Customers are not blocking or reporting this number.${tier}`,
        stale,
      };
    case 'YELLOW':
      return {
        level: 'warn',
        headline: 'Quality has dropped',
        detail:
          'Some customers have blocked or reported recent messages. Meta lowers the sending limit next, ' +
          `and restricts the number if it keeps falling. Send only to people who messaged you first.${tier}`,
        stale,
      };
    case 'RED':
      return {
        level: 'critical',
        headline: 'Quality is low — this number is at risk',
        detail:
          'Meta has flagged this number and will restrict it if quality does not recover. Stop any ' +
          `outreach that was not asked for, and reply only to customers who messaged you.${tier}`,
        stale,
      };
    default:
      return {
        level: 'unknown',
        headline: 'Quality not reported yet',
        detail:
          'Meta reports a rating once the number has sent enough messages. A number in a market where ' +
          `this is not published also shows nothing here.${tier}`,
        stale,
      };
  }
}

/** "TIER_1K" reads as a code; "1,000 customers/day" reads as a limit. */
export function friendlyTier(tier: string): string {
  switch (tier.toUpperCase()) {
    case 'TIER_250':
      return '250 customers/day';
    case 'TIER_1K':
      return '1,000 customers/day';
    case 'TIER_10K':
      return '10,000 customers/day';
    case 'TIER_100K':
      return '100,000 customers/day';
    case 'TIER_UNLIMITED':
      return 'unlimited';
    default:
      // An unrecognised tier is shown as Meta sent it rather than hidden:
      // a new tier name is information, and swallowing it would leave the
      // operator with less than Meta gave us.
      return tier;
  }
}
