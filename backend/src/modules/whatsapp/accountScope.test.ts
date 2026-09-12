import { accountScopeFilter } from './whatsapp.service';

/**
 * No database: the filter is pure, and it is the piece of multi-Business-
 * Manager support most able to break the deployment that already works.
 *
 * Adding a number used to reuse the tenant's one account unconditionally.
 * Under two BMs that would attach a number to whichever account was
 * oldest — quite possibly the other Business Manager's, whose access
 * token cannot see this number. Nothing throws; the row looks correct,
 * and the send fails at Meta with a permissions error naming none of it.
 */
describe('accountScopeFilter', () => {
  it('matches only accounts with no Business Manager when none is given', () => {
    // This is the existing deployment. Its accounts predate the field, so
    // they carry no metaAppId — and they must keep being found, or every
    // number added creates a second account and splits the workspace.
    expect(accountScopeFilter()).toEqual({ metaAppId: { $exists: false } });
  });

  it('uses $exists rather than null for the no-BM case', () => {
    // { metaAppId: null } also matches absent fields in MongoDB, but it
    // additionally matches an explicit null — a different thing that would
    // then be treated as "belongs to no BM" when it may mean "unassigned".
    const filter = accountScopeFilter() as { metaAppId: unknown };
    expect(filter.metaAppId).not.toBeNull();
    expect(filter.metaAppId).toEqual({ $exists: false });
  });

  it('matches exactly one Business Manager when one is given', () => {
    expect(accountScopeFilter('507f1f77bcf86cd799439011')).toEqual({
      metaAppId: '507f1f77bcf86cd799439011',
    });
  });

  it('never returns an unscoped filter', () => {
    // The bug this whole function replaces: an empty filter, which finds
    // some other Business Manager's account and sends with its token.
    for (const filter of [accountScopeFilter(), accountScopeFilter('507f1f77bcf86cd799439011')]) {
      expect(Object.keys(filter)).toEqual(['metaAppId']);
    }
  });

  it('treats an empty string as no Business Manager, not as one named ""', () => {
    // A form that submits an untouched dropdown sends '', and querying for
    // an account whose metaAppId is the empty string would find nothing
    // and silently create a duplicate account every time.
    expect(accountScopeFilter('')).toEqual({ metaAppId: { $exists: false } });
  });
});
