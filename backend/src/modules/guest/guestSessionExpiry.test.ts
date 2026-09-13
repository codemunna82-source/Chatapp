import { guestSessionExpiresAt, isNonExpiring } from './guestSessionExpiry';
import { env } from '../../config/env';

const NOW = new Date('2026-09-13T12:00:00Z');

describe('guestSessionExpiresAt', () => {
  const original = env.GUEST_SESSION_TTL_DAYS;
  afterEach(() => {
    (env as { GUEST_SESSION_TTL_DAYS: number }).GUEST_SESSION_TTL_DAYS = original;
  });

  function setTtl(days: number) {
    (env as { GUEST_SESSION_TTL_DAYS: number }).GUEST_SESSION_TTL_DAYS = days;
  }

  it('adds the configured number of days', () => {
    setTtl(30);
    expect(guestSessionExpiresAt(NOW).toISOString()).toBe('2026-10-13T12:00:00.000Z');
  });

  // The whole point of the setting: a link that is never taken away.
  it('never expires when the TTL is zero', () => {
    setTtl(0);
    const at = guestSessionExpiresAt(NOW);
    expect(isNonExpiring(at)).toBe(true);
    expect(at.getTime()).toBeGreaterThan(new Date('2200-01-01').getTime());
  });

  // Still has to satisfy the `expiresAt: { $gt: new Date() }` every lookup
  // filters on — a "never" that a query reads as past would lock every
  // customer out instead of letting them all in.
  it('is in the future either way', () => {
    for (const days of [0, 1, 30, 3650]) {
      setTtl(days);
      expect(guestSessionExpiresAt(NOW).getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it('does not mistake an ordinary expiry for never', () => {
    setTtl(3650);
    expect(isNonExpiring(guestSessionExpiresAt(NOW))).toBe(false);
  });
});
