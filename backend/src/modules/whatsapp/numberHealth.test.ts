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
