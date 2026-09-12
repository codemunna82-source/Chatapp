import { createHmac } from 'node:crypto';
import {
  verifyChallenge,
  verifySignature,
  checkSignature,
  appSecretHasExpectedShape,
} from './webhookVerifier';
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

/**
 * Multi-Business-Manager verification.
 *
 * This is the property the whole per-app webhook URL exists for: two Meta
 * apps sign with two different secrets, and neither one verifies the
 * other's deliveries. Before the URL carried the app, every workspace was
 * pinned to a single global secret — so a number added under a second
 * Business Manager sent fine and then had every inbound message rejected
 * with a 401 that looked identical to a misconfiguration.
 */
describe('per-app webhook secrets', () => {
  const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [] }));
  const bm1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const bm2 = '0f9e8d7c6b5a4938271605f4e3d2c1b0';
  const sign = (secret: string) =>
    `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  it('accepts each app against its own secret', () => {
    expect(checkSignature(body, sign(bm1), bm1)).toEqual({ ok: true });
    expect(checkSignature(body, sign(bm2), bm2)).toEqual({ ok: true });
  });

  it('refuses one app signed with the other app’s secret', () => {
    // The exact failure a shared global secret produced for every number
    // outside the first Business Manager.
    expect(checkSignature(body, sign(bm2), bm1)).toEqual({ ok: false, reason: 'DIGEST_MISMATCH' });
    expect(checkSignature(body, sign(bm1), bm2)).toEqual({ ok: false, reason: 'DIGEST_MISMATCH' });
  });

  it('reports an unknown webhook URL as an unconfigured secret, not a mismatch', () => {
    // A URL naming an app this workspace does not have resolves to an empty
    // secret. Distinguishing it matters: "not configured" sends an admin to
    // the URL they pasted, "mismatch" sends them to the secret — and only
    // one of those is where the problem is.
    expect(checkSignature(body, sign(bm1), '')).toEqual({
      ok: false,
      reason: 'APP_SECRET_NOT_CONFIGURED',
    });
  });

  it('keeps each app’s verify token to itself', () => {
    const query = (token: string) => ({
      'hub.mode': 'subscribe',
      'hub.verify_token': token,
      'hub.challenge': '42',
    });
    expect(verifyChallenge(query('token-for-bm1'), 'token-for-bm1')).toEqual({ ok: true, challenge: '42' });
    expect(verifyChallenge(query('token-for-bm1'), 'token-for-bm2')).toEqual({
      ok: false,
      reason: 'TOKEN_MISMATCH',
    });
  });

  it('refuses an empty expected token rather than matching an empty one sent', () => {
    // An app whose stored token could not be decrypted resolves to ''. It
    // must reject every caller, not accept whoever sends a blank token.
    expect(
      verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '42' }, ''),
    ).toEqual({ ok: false, reason: 'VERIFY_TOKEN_NOT_CONFIGURED' });
  });

  it('judges each secret’s shape independently', () => {
    expect(appSecretHasExpectedShape(bm1)).toBe(true);
    // An access token pasted into the app-secret box — the common mistake,
    // and worth catching per app now that there are several to confuse.
    expect(appSecretHasExpectedShape('EAAUydPo2YYkBS' + 'x'.repeat(200))).toBe(false);
  });
});

/**
 * The existing single-Business-Manager deployment, unchanged.
 *
 * Multi-BM support was added by giving these two functions an optional
 * parameter. That is only safe if omitting it behaves exactly as before —
 * the live deployment's Meta dashboard still points at the bare
 * /api/webhooks/meta, verified against the global META_* values, and a
 * regression here takes a working system down to serve one that is not
 * in use yet.
 *
 * So these test the OLD call shape on purpose, with no extra argument.
 */
describe('the global META_* configuration still works untouched', () => {
  const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));

  it('verifies a signature against the environment when no app is named', () => {
    const sig = `sha256=${createHmac('sha256', env.META_APP_SECRET).update(body).digest('hex')}`;
    expect(checkSignature(body, sig)).toEqual({ ok: true });
    expect(verifySignature(body, sig)).toBe(true);
  });

  it('still rejects a wrong secret when no app is named', () => {
    const sig = `sha256=${createHmac('sha256', 'f'.repeat(32)).update(body).digest('hex')}`;
    expect(checkSignature(body, sig)).toEqual({ ok: false, reason: 'DIGEST_MISMATCH' });
  });

  it('answers the challenge against the environment token when no app is named', () => {
    expect(
      verifyChallenge({
        'hub.mode': 'subscribe',
        'hub.verify_token': env.META_VERIFY_TOKEN,
        'hub.challenge': 'abc',
      }),
    ).toEqual({ ok: true, challenge: 'abc' });
  });

  it('still rejects a wrong challenge token when no app is named', () => {
    expect(
      verifyChallenge({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'not-the-token',
        'hub.challenge': 'abc',
      }),
    ).toEqual({ ok: false, reason: 'TOKEN_MISMATCH' });
  });

  it('reports the environment secret’s shape when no app is named', () => {
    expect(appSecretHasExpectedShape()).toBe(/^[0-9a-f]{32}$/.test(env.META_APP_SECRET));
  });
});
