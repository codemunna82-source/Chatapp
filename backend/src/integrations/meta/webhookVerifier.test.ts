import { createHmac } from 'node:crypto';
import { verifyChallenge, verifySignature } from './webhookVerifier';
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
