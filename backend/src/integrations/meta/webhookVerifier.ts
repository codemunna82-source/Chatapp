import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';

/**
 * GET /api/webhooks/meta challenge-response, required once when subscribing
 * the webhook URL in the Meta App dashboard (spec §16). Returns the
 * challenge string to echo back, or null if the verify token doesn't match.
 */
export function verifyChallenge(query: Record<string, unknown>): string | null {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];

  if (mode === 'subscribe' && typeof token === 'string' && typeof challenge === 'string') {
    if (token === env.META_VERIFY_TOKEN) {
      return challenge;
    }
  }
  return null;
}

/**
 * Verifies the `X-Hub-Signature-256` HMAC Meta signs every webhook POST
 * with, computed over the exact raw request bytes (spec §16). Must be
 * called with the untouched body buffer — not a re-serialized JSON.parse'd
 * object, which can differ byte-for-byte from what Meta actually hashed.
 */
export function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  if (!env.META_APP_SECRET) return false;

  const expectedHex = createHmac('sha256', env.META_APP_SECRET).update(rawBody).digest('hex');
  const providedHex = signatureHeader.slice('sha256='.length);

  const expected = Buffer.from(expectedHex, 'hex');
  const provided = Buffer.from(providedHex, 'hex');
  if (expected.length !== provided.length) return false;

  return timingSafeEqual(expected, provided);
}
