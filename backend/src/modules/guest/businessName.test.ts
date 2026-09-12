import { resolveBusinessName } from './businessName';

describe('resolveBusinessName', () => {
  it('prefers what the admin set in settings over everything else', () => {
    expect(
      resolveBusinessName({
        displayName: 'RK Enterprises',
        verifiedName: 'RK Ent Pvt Ltd',
        tenantName: 'Head office',
      }),
    ).toEqual({ name: 'RK Enterprises', source: 'settings' });
  });

  it("falls back to Meta's approved name for the number the customer messaged", () => {
    expect(
      resolveBusinessName({ displayName: '', verifiedName: 'RK Ent Pvt Ltd', tenantName: 'Head office' }),
    ).toEqual({ name: 'RK Ent Pvt Ltd', source: 'whatsapp' });
  });

  it('falls back to the workspace name when there is nothing better', () => {
    expect(resolveBusinessName({ tenantName: 'Head office' })).toEqual({
      name: 'Head office',
      source: 'workspace',
    });
  });

  // The bug this module was written for: a fresh install's Tenant.name is
  // "Demo Tenant", and it was going out as the header of a real business's
  // customer-facing chat window.
  it('never shows a seeded placeholder to a customer', () => {
    expect(resolveBusinessName({ tenantName: 'Demo Tenant' })).toEqual({
      name: 'Support',
      source: 'fallback',
    });
    expect(resolveBusinessName({ tenantName: 'demo tenant' }).name).toBe('Support');
    expect(resolveBusinessName({ tenantName: '  Demo Tenant  ' }).name).toBe('Support');
    expect(resolveBusinessName({ verifiedName: 'VOXO Demo Business', tenantName: 'Demo Tenant' }).name).toBe(
      'Support',
    );
  });

  it('skips the placeholder but still uses a real name behind it', () => {
    expect(
      resolveBusinessName({ displayName: 'Demo Tenant', verifiedName: 'RK Ent Pvt Ltd' }),
    ).toEqual({ name: 'RK Ent Pvt Ltd', source: 'whatsapp' });
  });

  // Only a full match is a placeholder. A workspace genuinely called
  // "Demo Kitchens" must keep its name.
  it('does not mistake a real name that merely contains "demo"', () => {
    expect(resolveBusinessName({ tenantName: 'Demo Kitchens' })).toEqual({
      name: 'Demo Kitchens',
      source: 'workspace',
    });
  });

  it('treats blank and whitespace-only values as unset', () => {
    expect(resolveBusinessName({ displayName: '   ', verifiedName: '', tenantName: 'Head office' }).name).toBe(
      'Head office',
    );
    expect(resolveBusinessName({}).name).toBe('Support');
  });

  it('trims what it returns, so the header never renders padded', () => {
    expect(resolveBusinessName({ displayName: '  RK Enterprises ' }).name).toBe('RK Enterprises');
  });
});
