import { createHmac } from 'node:crypto';
import { verifyChallenge, verifySignature, checkSignature } from './webhookVerifier';
import { env } from '../../config/env';

describe('verifyChallenge', () => {
  it('returns the challenge string when mode and verify_token match', () => {
    const result = verifyChallenge({
      'hub.mode': 'subscribe',
      'hub.verify_token': env.META_VERIFY_TOKEN,
      'hub.challenge': '1234567890',
    });
    expect(result).toEqual({ ok: true, challenge: '1234567890' });
  });

  it('reports TOKEN_MISMATCH when the verify token is wrong', () => {
    const result = verifyChallenge({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong-token',
      'hub.challenge': '1234567890',
    });
    expect(result).toEqual({ ok: false, reason: 'TOKEN_MISMATCH' });
  });

  it('reports MODE_NOT_SUBSCRIBE when mode is not "subscribe"', () => {
    const result = verifyChallenge({
      'hub.mode': 'unsubscribe',
      'hub.verify_token': env.META_VERIFY_TOKEN,
      'hub.challenge': '1234567890',
    });
    expect(result).toEqual({ ok: false, reason: 'MODE_NOT_SUBSCRIBE' });
  });

  it('reports MISSING_PARAMS when required fields are absent', () => {
    expect(verifyChallenge({})).toEqual({ ok: false, reason: 'MISSING_PARAMS' });
    expect(verifyChallenge({ 'hub.mode': 'subscribe' })).toEqual({
      ok: false,
      reason: 'MISSING_PARAMS',
    });
  });

  it('rejects an empty verify_token rather than matching an unconfigured token', () => {
    // The regression this guards: META_VERIFY_TOKEN used to default to '',
    // so a deployment that never set it accepted `hub.verify_token=` from
    // anyone — the token check passed by comparing '' to ''.
    const restore = jest.replaceProperty(env, 'META_VERIFY_TOKEN', '');
    try {
      expect(
        verifyChallenge({
          'hub.mode': 'subscribe',
          'hub.verify_token': '',
          'hub.challenge': '1234567890',
        }),
      ).toEqual({ ok: false, reason: 'VERIFY_TOKEN_NOT_CONFIGURED' });
    } finally {
      restore.restore();
    }
  });
});

describe('verifySignature', () => {
  const payload = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [] }));

  function sign(body: Buffer, secret: string): string {
    return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  }

  it('accepts a correctly signed body', () => {
    const signature = sign(payload, env.META_APP_SECRET);
    expect(verifySignature(payload, signature)).toBe(true);
  });

  it('rejects a body signed with the wrong secret', () => {
    const signature = sign(payload, 'a-different-secret');
    expect(verifySignature(payload, signature)).toBe(false);
  });

  it('rejects a tampered body even with the "right-looking" signature header', () => {
    const signature = sign(payload, env.META_APP_SECRET);
    const tampered = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ evil: true }] }));
    expect(verifySignature(tampered, signature)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifySignature(payload, undefined)).toBe(false);
  });

  it('rejects a malformed signature header (no sha256= prefix)', () => {
    expect(verifySignature(payload, 'not-a-real-signature')).toBe(false);
  });
});

/**
 * The reasons exist so a 401 in the production log says which of five
 * things went wrong. Pinned individually because they are only useful if
 * they are actually distinct — a version that collapsed two of them into
 * one would still pass every pass/fail test above.
 */
describe('checkSignature reasons', () => {
  const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));
  const sign = (secret: string) =>
    `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  it('reports ok for a correctly signed body', () => {
    expect(checkSignature(body, sign(env.META_APP_SECRET))).toEqual({ ok: true });
  });

  it('separates "wrong secret" from every other failure', () => {
    // This is the one that matters in production: the delivery is real,
    // well-formed and correctly signed — by an app whose secret we do not
    // have. Nothing about the request is fixable; the environment is.
    expect(checkSignature(body, sign('a'.repeat(32)))).toEqual({
      ok: false,
      reason: 'DIGEST_MISMATCH',
    });
  });

  it('separates a missing header from a malformed one', () => {
    expect(checkSignature(body, undefined)).toEqual({ ok: false, reason: 'HEADER_MISSING' });
    expect(checkSignature(body, 'sha1=abc')).toEqual({ ok: false, reason: 'HEADER_MALFORMED' });
  });

  it('reports a short digest as a length mismatch, not a comparison failure', () => {
    // Buffer.from(hex) drops what it cannot decode instead of throwing, so
    // a truncated or garbage digest has to be caught on length — otherwise
    // timingSafeEqual throws on mismatched buffers and this becomes a 500.
    expect(checkSignature(body, 'sha256=abcd')).toEqual({
      ok: false,
      reason: 'DIGEST_LENGTH_MISMATCH',
    });
    expect(checkSignature(body, 'sha256=zzzz')).toEqual({
      ok: false,
      reason: 'DIGEST_LENGTH_MISMATCH',
    });
  });

  it('keeps verifySignature agreeing with it', () => {
    expect(verifySignature(body, sign(env.META_APP_SECRET))).toBe(true);
    expect(verifySignature(body, sign('a'.repeat(32)))).toBe(false);
  });
});
