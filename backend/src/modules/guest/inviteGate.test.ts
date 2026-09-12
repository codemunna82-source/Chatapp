/**
 * The rules that decide whether a customer is invited again.
 *
 * Extracted and tested as a pure function because getting them wrong is
 * invisible from both sides: too strict and a customer who never saw the
 * link is never sent another, too loose and every message they write earns
 * an identical invitation — which is the definition of spam, from a
 * business they were trying to talk to.
 */
import { shouldSendInvite } from './guestAutoReply.service';

describe('shouldSendInvite', () => {
  it('invites a customer who has no session at all', () => {
    expect(shouldSendInvite(null, 2)).toBe(true);
  });

  it('invites again while under the cap', () => {
    // The case this feature exists for: they wrote a second time without
    // tapping the link, so they almost certainly did not see it.
    expect(shouldSendInvite({ invitesSent: 1, activatedAt: null }, 2)).toBe(true);
  });

  it('stops at the cap', () => {
    expect(shouldSendInvite({ invitesSent: 2, activatedAt: null }, 2)).toBe(false);
    expect(shouldSendInvite({ invitesSent: 5, activatedAt: null }, 2)).toBe(false);
  });

  it('never invites a customer who has already moved over', () => {
    // Even with sends to spare. An invitation arriving on WhatsApp while
    // they are mid-sentence in the window reads as a business that is not
    // paying attention.
    expect(shouldSendInvite({ invitesSent: 0, activatedAt: new Date() }, 3)).toBe(false);
  });

  it('treats a missing count as zero rather than skipping', () => {
    // Sessions created before invitesSent existed have no value for it.
    // Reading that as "already sent" would silence every one of them.
    expect(shouldSendInvite({ activatedAt: null }, 1)).toBe(true);
  });

  it('sends exactly once on the default cap', () => {
    expect(shouldSendInvite(null, 1)).toBe(true);
    expect(shouldSendInvite({ invitesSent: 1, activatedAt: null }, 1)).toBe(false);
  });
});
