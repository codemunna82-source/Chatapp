/**
 * The one-device rule, as a pure decision.
 *
 * Extracted rather than tested through the routes because the DB-backed
 * suites cannot run here, and because getting this wrong has two failure
 * modes that look nothing alike: too strict signs every user out on
 * deploy, too loose leaves the feature doing nothing.
 */
import { isSessionReplaced } from './singleDevice';

describe('isSessionReplaced', () => {
  it('allows the device that signed in most recently', () => {
    expect(isSessionReplaced('fam-A', 'fam-A')).toBe(false);
  });

  it('refuses a device whose session has been replaced', () => {
    expect(isSessionReplaced('fam-A', 'fam-B')).toBe(true);
  });

  // The deploy that added the field must not sign anyone out: a user who
  // has not signed in since has no active family at all.
  it('allows everything while no sign-in has claimed the account', () => {
    expect(isSessionReplaced(undefined, 'fam-A')).toBe(false);
    expect(isSessionReplaced(undefined, undefined)).toBe(false);
    expect(isSessionReplaced('', 'fam-A')).toBe(false);
  });

  // A token minted before the claim existed. It keeps working until its
  // owner signs in somewhere — and then it is exactly what should stop.
  it('refuses a token with no family once a sign-in has claimed the account', () => {
    expect(isSessionReplaced('fam-A', undefined)).toBe(true);
  });
});
