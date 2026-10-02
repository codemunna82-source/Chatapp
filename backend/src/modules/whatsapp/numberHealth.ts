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
  /** Meta's review state for the business display name shown to customers. */
  nameStatus?: string;
  /** Meta's health_status verdict: AVAILABLE, LIMITED, BLOCKED. */
  canSendMessage?: string;
  /** Meta's own sentence for why sending is not fully available. */
  sendBlockReason?: string;
  healthCheckedAt?: Date | string;
  now?: Date;
}): NumberHealth {
  const now = input.now ?? new Date();
  const checkedAt = input.healthCheckedAt ? new Date(input.healthCheckedAt) : undefined;
  const stale = !checkedAt || now.getTime() - checkedAt.getTime() > STALE_AFTER_MS;

  const rating = (input.qualityRating ?? '').toUpperCase();
  const tier = input.messagingLimitTier ? ` Current limit: ${friendlyTier(input.messagingLimitTier)}.` : '';

  /**
   * The display name comes first, ahead of the quality rating.
   *
   * Quality describes a trend — how customers have reacted to what was
   * sent. The display name describes whether the number may send at all:
   * until Meta has approved it, the number is held at a limit, and Meta
   * reports that as can_send_message: LIMITED on the number while the
   * account, the business and the app all read AVAILABLE. A send in that
   * state is accepted by the API and then refused at delivery, which
   * reaches the agent as a bare failed tick and reaches an admin, in
   * Meta's own words, as "Business Account locked" — naming the one thing
   * that is NOT the problem.
   *
   * It is reported even when quality is GREEN, because that is exactly
   * the case that misleads: a healthy rating on a number nothing can
   * leave reads as an all-clear.
   */
  /**
   * Meta's own verdict comes first, ahead of everything inferred.
   *
   * The other fields describe the number; this one describes what Meta
   * will do with it, and when they disagree this is the one that decides
   * whether a customer receives anything. The number this was written for
   * read back CONNECTED, GREEN and AVAILABLE_WITHOUT_REVIEW while
   * health_status called it LIMITED — and health_status was right.
   *
   * Meta's own sentence is used verbatim rather than translated. Every
   * rewording here is a guess about a state Meta may have changed since,
   * and the raw sentence is both current and quotable in a support
   * ticket, which a paraphrase is not.
   */
  const verdict = (input.canSendMessage ?? '').toUpperCase();
  if (verdict && verdict !== 'AVAILABLE') {
    const limited = verdict === 'LIMITED';
    return {
      level: limited ? 'warn' : 'critical',
      headline: limited
        ? 'Meta is limiting this number — some messages may not arrive'
        : 'Meta is not delivering from this number',
      detail:
        (input.sendBlockReason ? `Meta says: ${input.sendBlockReason} ` : '') +
        'A message can be accepted by WhatsApp and then refused at delivery, so a failed message here ' +
        `is not a fault in this app.${tier}`,
      stale,
    };
  }

  const nameState = (input.nameStatus ?? '').toUpperCase();
  const nameHealth = describeNameStatus(nameState, tier, stale);
  if (nameHealth) return nameHealth;

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

/**
 * The display name's review state, when it is something to act on.
 *
 * Null for the two states that are fine — APPROVED, and the
 * AVAILABLE_WITHOUT_REVIEW that Meta gives a name needing no review — and
 * null for an empty value, which means the number has never been read
 * rather than that anything is wrong.
 */
function describeNameStatus(nameStatus: string, tier: string, stale: boolean): NumberHealth | null {
  switch (nameStatus) {
    case 'DECLINED':
      return {
        level: 'critical',
        headline: 'Display name was rejected — messages will not arrive',
        detail:
          'Meta rejected the business name shown to customers, so this number is held at a limit and ' +
          'messages can be accepted and then not delivered. Submit a name that matches the real, ' +
          'registered business — a generic word, a misspelling, or a name that does not match the ' +
          `business is the usual reason for a rejection.${tier}`,
        stale,
      };
    case 'PENDING_REVIEW':
      return {
        level: 'critical',
        headline: 'Display name is waiting for Meta — messages may not arrive',
        detail:
          'Until Meta approves the business name shown to customers, this number is held at a limit. ' +
          'A message can be accepted by WhatsApp and then refused at delivery, with the customer ' +
          `receiving nothing. Nothing is wrong with this app — the approval is the thing to chase.${tier}`,
        stale,
      };
    case 'EXPIRED':
      return {
        level: 'critical',
        headline: 'Display name approval has expired',
        detail:
          'Meta no longer treats the business name on this number as approved, which holds it at a ' +
          `limit. Resubmit the display name in WhatsApp Manager.${tier}`,
        stale,
      };
    case 'NONE':
      return {
        level: 'warn',
        headline: 'No display name submitted yet',
        detail:
          'Customers see no approved business name on this number, and it stays at a limit until one ' +
          `is submitted and approved.${tier}`,
        stale,
      };
    default:
      return null;
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
