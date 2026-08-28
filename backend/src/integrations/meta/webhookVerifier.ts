import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';

/**
 * Why the challenge failed. Returned instead of a bare null so the route can
 * log the actual cause: Meta's dashboard only ever says "The callback URL or
 * verify token couldn't be validated", which is true of all four of these,
 * and without a server-side reason the operator has nothing to go on.
 */
export type ChallengeFailureReason =
  /** No META_VERIFY_TOKEN in this deployment's environment at all. */
  | 'VERIFY_TOKEN_NOT_CONFIGURED'
  /** hub.mode / hub.verify_token / hub.challenge missing or not strings. */
  | 'MISSING_PARAMS'
  /** hub.mode was something other than "subscribe". */
  | 'MODE_NOT_SUBSCRIBE'
  /** Token present on both sides but different. */
  | 'TOKEN_MISMATCH';

export type ChallengeResult =
  | { ok: true; challenge: string }
  | { ok: false; reason: ChallengeFailureReason };

/**
 * GET /api/webhooks/meta challenge-response, required once when subscribing
 * the webhook URL in the Meta App dashboard (spec §16).
 */
export function verifyChallenge(query: Record<string, unknown>): ChallengeResult {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];

  // Checked before anything else, and never treated as "matches an empty
  // token": an unconfigured deployment must reject every caller, not accept
  // whoever happens to send hub.verify_token= with no value.
  if (!env.META_VERIFY_TOKEN) {
    return { ok: false, reason: 'VERIFY_TOKEN_NOT_CONFIGURED' };
  }

  if (typeof mode !== 'string' || typeof token !== 'string' || typeof challenge !== 'string') {
    return { ok: false, reason: 'MISSING_PARAMS' };
  }
  if (mode !== 'subscribe') {
    return { ok: false, reason: 'MODE_NOT_SUBSCRIBE' };
  }
  if (token !== env.META_VERIFY_TOKEN) {
    return { ok: false, reason: 'TOKEN_MISMATCH' };
  }

  return { ok: true, challenge };
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
