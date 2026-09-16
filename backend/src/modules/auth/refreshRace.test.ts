import { __testing } from './auth.service';

const { isConcurrentRefresh, REFRESH_RACE_GRACE_MS } = __testing;

function record(over: { revokedAt?: Date | null; replacedByJti?: string | null }) {
  return { revokedAt: over.revokedAt ?? null, replacedByJti: over.replacedByJti ?? null } as never;
}

/**
 * Telling two refreshes racing apart from a stolen token replayed.
 *
 * The production failure: the UI and the headless push handler each
 * refreshed within a second of each other, both succeeded, and the
 * loser's token was then read as theft — revoking the whole family and
 * signing the user out permanently, with re-login the only way back.
 */
describe('isConcurrentRefresh', () => {
  it('forgives a token rotated a moment ago whose replacement is live', () => {
    expect(isConcurrentRefresh(record({ revokedAt: new Date(), replacedByJti: 'next' }))).toBe(true);
  });

  it('still catches a token replayed long after its rotation', () => {
    const old = new Date(Date.now() - REFRESH_RACE_GRACE_MS - 1000);
    expect(isConcurrentRefresh(record({ revokedAt: old, replacedByJti: 'next' }))).toBe(false);
  });

  it('does not forgive a revoked token that was never rotated', () => {
    // No replacement means it was revoked outright — a sign-out, or the
    // family being cut — not the losing half of a rotation.
    expect(isConcurrentRefresh(record({ revokedAt: new Date(), replacedByJti: null }))).toBe(false);
  });

  it('says nothing about a token that is not revoked at all', () => {
    expect(isConcurrentRefresh(record({ revokedAt: null, replacedByJti: 'next' }))).toBe(false);
  });

  it('keeps the window far longer than a race and far shorter than an attack', () => {
    // Two refreshes 0.8s apart is what was actually observed; a stolen
    // token turns up minutes or hours later.
    expect(REFRESH_RACE_GRACE_MS).toBeGreaterThanOrEqual(10_000);
    expect(REFRESH_RACE_GRACE_MS).toBeLessThanOrEqual(120_000);
  });
});
