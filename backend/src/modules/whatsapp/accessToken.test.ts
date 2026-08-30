import { resolveAccessToken } from './whatsapp.service';
import { env } from '../../config/env';
import { encryptSecret, resetEncryptionKeyCache } from '../../lib/crypto';

/**
 * No database: this is the pure half of credential resolution, and it is
 * the piece that decides whether a real send uses a real token or the
 * seeded placeholder (which Meta rejects with error 190).
 */
describe('resolveAccessToken', () => {
  const original = env.META_ACCESS_TOKEN;
  afterEach(() => {
    (env as { META_ACCESS_TOKEN: string }).META_ACCESS_TOKEN = original;
  });
  function setEnvToken(value: string) {
    (env as { META_ACCESS_TOKEN: string }).META_ACCESS_TOKEN = value;
  }

  it('uses a stored real token as-is', () => {
    setEnvToken('env-token');
    expect(resolveAccessToken('EAAG-real-stored-token')).toBe('EAAG-real-stored-token');
  });

  it('falls back to META_ACCESS_TOKEN for the seeded mock: placeholder', () => {
    setEnvToken('env-token');
    expect(resolveAccessToken('mock:demo-access-token')).toBe('env-token');
  });

  it('falls back for an empty or missing ref', () => {
    setEnvToken('env-token');
    expect(resolveAccessToken('')).toBe('env-token');
    expect(resolveAccessToken('   ')).toBe('env-token');
    expect(resolveAccessToken(undefined)).toBe('env-token');
  });

  it('fails loudly when neither a stored token nor the env var is set', () => {
    setEnvToken('');
    // Better than handing Meta an empty string and reading back a generic
    // 190 — this names the actual missing piece.
    expect(() => resolveAccessToken('mock:demo-access-token')).toThrow(/no whatsapp access token/i);
  });
});

describe('resolveAccessToken — env: refs', () => {
  const original = env.META_ACCESS_TOKEN;
  afterEach(() => {
    (env as { META_ACCESS_TOKEN: string }).META_ACCESS_TOKEN = original;
  });

  it('treats an env: ref as a placeholder, not as the token itself', () => {
    // findOrCreateRealAccount writes 'env:META_ACCESS_TOKEN'. Using that
    // string verbatim as a bearer token would fail every call with a 190.
    (env as { META_ACCESS_TOKEN: string }).META_ACCESS_TOKEN = 'env-token';
    expect(resolveAccessToken('env:META_ACCESS_TOKEN')).toBe('env-token');
  });
});

describe('resolveAccessToken — a connection with its own encrypted token', () => {
  const originalToken = env.META_ACCESS_TOKEN;
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    resetEncryptionKeyCache();
    (env as { META_ACCESS_TOKEN: string }).META_ACCESS_TOKEN = 'platform-token';
  });
  afterEach(() => {
    (env as { META_ACCESS_TOKEN: string }).META_ACCESS_TOKEN = originalToken;
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
    resetEncryptionKeyCache();
  });

  it("prefers the connection's own token over the platform one", () => {
    // The whole point of Embedded Signup: a user who connected their own
    // WhatsApp must send with their own credentials, not the platform's.
    const enc = encryptSecret('their-own-token');
    expect(resolveAccessToken('enc:accessTokenEnc', enc)).toBe('their-own-token');
  });

  it('falls back to the platform token when there is no encrypted one', () => {
    // The existing single-number deployment, unchanged.
    expect(resolveAccessToken('mock:demo-access-token', undefined)).toBe('platform-token');
    expect(resolveAccessToken('enc:accessTokenEnc', null)).toBe('platform-token');
  });

  it('fails rather than silently sending from the wrong number when the key rotated', () => {
    const enc = encryptSecret('their-own-token');
    process.env.ENCRYPTION_KEY = 'b'.repeat(64);
    resetEncryptionKeyCache();
    expect(() => resolveAccessToken('enc:accessTokenEnc', enc)).toThrow(/could not be read/i);
  });
});
