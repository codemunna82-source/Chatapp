import { describeNumberHealth, friendlyTier } from './numberHealth';

/**
 * No database. This is the whole point of surfacing a quality rating: an
 * operator who sees "YELLOW" learns nothing, and the warning only earns
 * its place if it says what happened and what to do.
 */
describe('describeNumberHealth', () => {
  const now = new Date('2026-09-09T12:00:00Z');
  const fresh = new Date('2026-09-09T11:30:00Z');

  it('reports a healthy number without alarming anyone', () => {
    const health = describeNumberHealth({ qualityRating: 'GREEN', healthCheckedAt: fresh, now });
    expect(health.level).toBe('ok');
    expect(health.stale).toBe(false);
  });

  it('treats YELLOW as the warning it is, not a colour', () => {
    // Meta lowers the tier before it restricts, so yellow is the moment
    // there is still something to do about it.
    const health = describeNumberHealth({ qualityRating: 'YELLOW', healthCheckedAt: fresh, now });
    expect(health.level).toBe('warn');
    expect(health.detail).toMatch(/messaged you first/i);
  });

  it('says plainly that a RED number is at risk', () => {
    const health = describeNumberHealth({ qualityRating: 'RED', healthCheckedAt: fresh, now });
    expect(health.level).toBe('critical');
    expect(health.headline).toMatch(/at risk/i);
  });

  it('does not invent a rating Meta has not given', () => {
    // A new number, or one in a market where Meta does not publish this.
    // Reporting it as healthy would be the dangerous lie.
    const health = describeNumberHealth({ healthCheckedAt: fresh, now });
    expect(health.level).toBe('unknown');
    expect(health.level).not.toBe('ok');
  });

  it('marks a reading nobody has refreshed as stale', () => {
    // The bug this feature exists to fix: the rating was written once at
    // registration and never again, so a number reported GREEN forever.
    const health = describeNumberHealth({
      qualityRating: 'GREEN',
      healthCheckedAt: new Date('2026-09-08T12:00:00Z'),
      now,
    });
    expect(health.stale).toBe(true);
  });

  it('treats never-checked as stale rather than current', () => {
    expect(describeNumberHealth({ qualityRating: 'GREEN', now }).stale).toBe(true);
  });

  it('includes the sending limit, which moves with the rating', () => {
    const health = describeNumberHealth({
      qualityRating: 'YELLOW',
      messagingLimitTier: 'TIER_1K',
      healthCheckedAt: fresh,
      now,
    });
    expect(health.detail).toContain('1,000 customers/day');
  });

  it('reads a lowercase rating the same as an uppercase one', () => {
    expect(describeNumberHealth({ qualityRating: 'red', healthCheckedAt: fresh, now }).level).toBe('critical');
  });
});

describe('friendlyTier', () => {
  it('turns Meta codes into limits a person can read', () => {
    expect(friendlyTier('TIER_250')).toBe('250 customers/day');
    expect(friendlyTier('TIER_UNLIMITED')).toBe('unlimited');
  });

  it('passes an unrecognised tier through rather than hiding it', () => {
    // A tier name we do not know yet is still information; swallowing it
    // would leave the operator with less than Meta gave us.
    expect(friendlyTier('TIER_500K')).toBe('TIER_500K');
  });
});

/**
 * The display name, which is what actually decided whether a message
 * arrived — and which nothing on any screen reported.
 *
 * The number read back CONNECTED with a High quality rating while every
 * send was accepted and then refused at delivery, because Meta holds a
 * number at a limit until the business name shown to customers is
 * approved. Its own code for that refusal says "Business Account locked",
 * naming the one level that was fine.
 */
describe('describeNumberHealth — display name', () => {
  const checkedAt = new Date('2026-10-02T19:00:00Z');
  const now = new Date('2026-10-02T19:05:00Z');

  it('reports a pending display name even while quality is GREEN', () => {
    // The case that misleads: a healthy rating on a number nothing can
    // leave reads as an all-clear.
    const health = describeNumberHealth({
      qualityRating: 'GREEN',
      nameStatus: 'PENDING_REVIEW',
      healthCheckedAt: checkedAt,
      now,
    });
    expect(health.level).toBe('critical');
    expect(health.headline).toMatch(/display name/i);
  });

  it('reports a rejected display name', () => {
    const health = describeNumberHealth({ nameStatus: 'DECLINED', healthCheckedAt: checkedAt, now });
    expect(health.level).toBe('critical');
    expect(health.headline).toMatch(/rejected/i);
  });

  it('reports an expired approval and a name never submitted', () => {
    expect(describeNumberHealth({ nameStatus: 'EXPIRED', healthCheckedAt: checkedAt, now }).level).toBe(
      'critical',
    );
    expect(describeNumberHealth({ nameStatus: 'NONE', healthCheckedAt: checkedAt, now }).level).toBe('warn');
  });

  it('stays out of the way once the name is settled', () => {
    // APPROVED and AVAILABLE_WITHOUT_REVIEW are both fine, and an unread
    // number must not be reported as a problem it has never had.
    for (const nameStatus of ['APPROVED', 'AVAILABLE_WITHOUT_REVIEW', undefined]) {
      const health = describeNumberHealth({
        qualityRating: 'GREEN',
        nameStatus,
        healthCheckedAt: checkedAt,
        now,
      });
      expect(health.level).toBe('ok');
    }
  });

  it('still carries the sending limit into the display-name wording', () => {
    const health = describeNumberHealth({
      nameStatus: 'PENDING_REVIEW',
      messagingLimitTier: 'TIER_250',
      healthCheckedAt: checkedAt,
      now,
    });
    expect(health.detail).toContain('250 customers/day');
  });
});
