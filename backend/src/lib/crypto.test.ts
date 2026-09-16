import {
  encryptSecret,
  decryptSecret,
  isEncryptedEnvelope,
  safeEqual,
  resetEncryptionKeyCache,
  encryptionKeyStatus,
} from './crypto';

// A fixed 32-byte key so these tests are deterministic. Never a real key.
const TEST_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64');

describe('secret encryption', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY_BASE64;
    resetEncryptionKeyCache();
  });

  it('round-trips a Meta access token', () => {
    const token = 'EAAG1234567890abcdefGHIJKLMNOP';
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  it('round-trips unicode and empty strings', () => {
    expect(decryptSecret(encryptSecret(''))).toBe('');
    expect(decryptSecret(encryptSecret('नमस्ते 🌏'))).toBe('नमस्ते 🌏');
  });

  it('produces a different ciphertext each time for the same input', () => {
    // A fresh IV per call. Without this, two tenants holding the same
    // token would be visibly identical in a database dump.
    const a = encryptSecret('same-token');
    const b = encryptSecret('same-token');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same-token');
    expect(decryptSecret(b)).toBe('same-token');
  });

  it('refuses a tampered ciphertext instead of returning garbage', () => {
    // The reason for GCM over CBC: altering the payload must fail loudly,
    // not yield a plausible string that then gets sent to Meta as a bearer
    // token.
    const envelope = encryptSecret('EAAGsecret');
    const [v, iv, tag, ct] = envelope.split(':') as [string, string, string, string];
    const flipped = Buffer.from(ct, 'base64url');
    flipped[0] = flipped[0]! ^ 0xff;
    const tampered = [v, iv, tag, flipped.toString('base64url')].join(':');

    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('refuses a swapped auth tag', () => {
    const a = encryptSecret('token-a');
    const b = encryptSecret('token-b');
    const [, ivA, , ctA] = a.split(':') as [string, string, string, string];
    const [, , tagB] = b.split(':') as [string, string, string, string];

    expect(() => decryptSecret(['v1', ivA, tagB, ctA].join(':'))).toThrow();
  });

  it('rejects a malformed or unknown-version envelope', () => {
    expect(() => decryptSecret('not-an-envelope')).toThrow(/Malformed/);
    expect(() => decryptSecret('v1:a:b')).toThrow(/Malformed/);
    expect(() => decryptSecret('v9:AAAA:BBBB:CCCC')).toThrow(/Unsupported/);
  });

  it('cannot be decrypted with a different key', () => {
    const envelope = encryptSecret('EAAGsecret');
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    resetEncryptionKeyCache();
    expect(() => decryptSecret(envelope)).toThrow();
  });

  it('accepts a hex key as well as base64', () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('hex');
    resetEncryptionKeyCache();
    expect(decryptSecret(encryptSecret('hex-keyed'))).toBe('hex-keyed');
  });

  it('fails loudly on a key of the wrong length', () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');
    resetEncryptionKeyCache();
    expect(() => encryptSecret('x')).toThrow(/32 bytes/);
  });

  it('fails loudly when no key is configured', () => {
    process.env.ENCRYPTION_KEY = '';
    resetEncryptionKeyCache();
    expect(() => encryptSecret('x')).toThrow(/ENCRYPTION_KEY is not set/);
  });
});

describe('isEncryptedEnvelope', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY_BASE64;
    resetEncryptionKeyCache();
  });

  it('recognises our own output', () => {
    expect(isEncryptedEnvelope(encryptSecret('token'))).toBe(true);
  });

  it('rejects the legacy plaintext values still in the database', () => {
    // These are what seed.ts wrote before encryption existed. The read
    // path uses this to tell them apart rather than attempting a decrypt
    // that would throw.
    expect(isEncryptedEnvelope('mock:demo-access-token')).toBe(false);
    expect(isEncryptedEnvelope('EAAGrealtokenvalue')).toBe(false);
    expect(isEncryptedEnvelope('')).toBe(false);
    expect(isEncryptedEnvelope(null)).toBe(false);
    expect(isEncryptedEnvelope(undefined)).toBe(false);
  });
});

describe('safeEqual', () => {
  it('matches identical strings and rejects everything else', () => {
    expect(safeEqual('abc123', 'abc123')).toBe(true);
    expect(safeEqual('abc123', 'abc124')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

/**
 * Reporting whether the key WORKS, separately from whether it is set.
 *
 * This exists because the two were conflated and it cost real time: a key
 * of the wrong length reported as configured, so the deployment's own
 * self-check said everything was fine while every encrypt threw a 500 the
 * admin UI showed as "Something went wrong. Please try again."
 */
describe('encryptionKeyStatus', () => {
  afterEach(() => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    resetEncryptionKeyCache();
  });

  it('reports a good base64 key as usable', () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    resetEncryptionKeyCache();
    expect(encryptionKeyStatus()).toEqual({
      configured: true,
      usable: true,
      bytes: 32,
      encoding: 'base64',
    });
  });

  it('recognises a hex key as hex, not as the 48 bytes base64 would make of it', () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('hex');
    resetEncryptionKeyCache();
    expect(encryptionKeyStatus()).toMatchObject({ usable: true, bytes: 32, encoding: 'hex' });
  });

  it('reports a short key as configured but NOT usable, and says how short', () => {
    // The exact production fault: someone typed a passphrase instead of
    // generating a key. 'configured' alone called this healthy.
    process.env.ENCRYPTION_KEY = 'voxo-secret-key!';
    resetEncryptionKeyCache();
    const status = encryptionKeyStatus();
    expect(status.configured).toBe(true);
    expect(status.usable).toBe(false);
    expect(status.bytes).toBeLessThan(32);
  });

  it('reports nothing set', () => {
    process.env.ENCRYPTION_KEY = '';
    resetEncryptionKeyCache();
    expect(encryptionKeyStatus()).toEqual({
      configured: false,
      usable: false,
      bytes: 0,
      encoding: 'none',
    });
  });

  it('agrees with what encryptSecret actually does', () => {
    // The whole point is that this never disagrees with reality, so the
    // two are asserted against each other rather than independently.
    process.env.ENCRYPTION_KEY = Buffer.alloc(12, 1).toString('base64');
    resetEncryptionKeyCache();
    expect(encryptionKeyStatus().usable).toBe(false);
    expect(() => encryptSecret('x')).toThrow(/32 bytes, got 12/);

    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    resetEncryptionKeyCache();
    expect(encryptionKeyStatus().usable).toBe(true);
    expect(() => encryptSecret('x')).not.toThrow();
  });
});
