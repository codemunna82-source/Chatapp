import { resolveAccessToken } from './whatsapp.service';
import { env } from '../../config/env';

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
