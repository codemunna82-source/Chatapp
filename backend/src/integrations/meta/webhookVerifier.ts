import { createHmac, timingSafeEqual } from 'node:crypto';
import { safeEqual } from '../../lib/crypto';
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
export function verifyChallenge(
  query: Record<string, unknown>,
  /**
   * The verify token to match against.
   *
   * Passed in rather than read from env so a per-app webhook URL can match
   * that app's own token — each Meta app (Business Manager) configures its
   * own, and they are not interchangeable. Omitted, it falls back to the
   * global META_VERIFY_TOKEN, which is what the single-app webhook URL
   * still uses.
   */
  expectedToken: string = env.META_VERIFY_TOKEN,
): ChallengeResult {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];

  // Checked before anything else, and never treated as "matches an empty
  // token": an unconfigured deployment must reject every caller, not accept
  // whoever happens to send hub.verify_token= with no value.
  if (!expectedToken) {
    return { ok: false, reason: 'VERIFY_TOKEN_NOT_CONFIGURED' };
  }

  if (typeof mode !== 'string' || typeof token !== 'string' || typeof challenge !== 'string') {
    return { ok: false, reason: 'MISSING_PARAMS' };
  }
  if (mode !== 'subscribe') {
    return { ok: false, reason: 'MODE_NOT_SUBSCRIBE' };
  }
  if (!safeEqual(token, expectedToken)) {
    return { ok: false, reason: 'TOKEN_MISMATCH' };
  }

  return { ok: true, challenge };
}

/**
 * Why a delivery's signature did not verify.
 *
 * Exists for the same reason ChallengeFailureReason does: a bare `false`
 * put a 401 in the log with no cause, and the four ways this fails need
 * four different fixes. Meta's dashboard, meanwhile, shows a delivery
 * failure and nothing about why.
 */
export type SignatureFailureReason =
  /** No X-Hub-Signature-256 header at all — not a Meta delivery. */
  | 'HEADER_MISSING'
  /** Header present but not in the `sha256=<hex>` form Meta sends. */
  | 'HEADER_MALFORMED'
  /** No META_APP_SECRET in this deployment's environment. */
  | 'APP_SECRET_NOT_CONFIGURED'
  /** The hex after `sha256=` did not decode to 32 bytes. */
  | 'DIGEST_LENGTH_MISMATCH'
  /** Everything well-formed, digests simply differ: the wrong app secret. */
  | 'DIGEST_MISMATCH';

export type SignatureResult = { ok: true } | { ok: false; reason: SignatureFailureReason };

/**
 * A Meta app secret is 32 lowercase hex characters, always.
 *
 * Reported alongside a DIGEST_MISMATCH because the overwhelmingly common
 * cause is a different Meta credential pasted into the META_APP_SECRET
 * box — an access token (a couple of hundred characters) or an App ID
 * (~15 digits). Knowing which of "wrong secret" and "wrong kind of
 * value entirely" you are looking at turns an unbounded hunt into a
 * single dashboard field.
 *
 * Safe to log: it says whether the configured value has the public,
 * documented SHAPE of an app secret. It reveals no part of the value,
 * and the shape itself is true of every Meta app secret in existence.
 */
export function appSecretHasExpectedShape(appSecret: string = env.META_APP_SECRET): boolean {
  return /^[0-9a-f]{32}$/.test(appSecret);
}

/**
 * Verifies the `X-Hub-Signature-256` HMAC Meta signs every webhook POST
 * with, computed over the exact raw request bytes (spec §16). Must be
 * called with the untouched body buffer — not a re-serialized JSON.parse'd
 * object, which can differ byte-for-byte from what Meta actually hashed.
 */
export function checkSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  /**
   * The app secret to verify against.
   *
   * Meta signs each webhook with the secret of the app subscribed to that
   * WABA, so a workspace spanning several Business Managers has several
   * secrets and no single one of them verifies every delivery. The caller
   * picks the right one from the webhook URL — which is known before any
   * of the body is trusted, and is the only thing that can be trusted at
   * that moment. Omitted, it falls back to the global META_APP_SECRET.
   */
  appSecret: string = env.META_APP_SECRET,
): SignatureResult {
  if (!signatureHeader) return { ok: false, reason: 'HEADER_MISSING' };
  if (!signatureHeader.startsWith('sha256=')) return { ok: false, reason: 'HEADER_MALFORMED' };
  if (!appSecret) return { ok: false, reason: 'APP_SECRET_NOT_CONFIGURED' };

  const expectedHex = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const providedHex = signatureHeader.slice('sha256='.length);

  const expected = Buffer.from(expectedHex, 'hex');
  const provided = Buffer.from(providedHex, 'hex');
  // Buffer.from ignores non-hex rather than throwing, so a garbage header
  // lands here as a short buffer rather than an exception.
  if (expected.length !== provided.length) return { ok: false, reason: 'DIGEST_LENGTH_MISMATCH' };

  if (!timingSafeEqual(expected, provided)) return { ok: false, reason: 'DIGEST_MISMATCH' };
  return { ok: true };
}

/** Boolean form, kept for callers that only branch on pass/fail. */
export function verifySignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret?: string,
): boolean {
  return checkSignature(rawBody, signatureHeader, appSecret).ok;
}
