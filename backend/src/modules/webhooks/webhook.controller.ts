import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { ApiError } from '../../lib/ApiError';
import { logger } from '../../lib/logger';
import { env } from '../../config/env';
import {
  verifyChallenge,
  checkSignature,
  appSecretHasExpectedShape,
} from '../../integrations/meta/webhookVerifier';
import { enqueueWebhookDelivery } from '../../queues/webhook.queue';
import { isRedisConfigured } from '../../queues/connection';
import { getPushGateway } from '../../integrations/fcm';
import { processWebhookDelivery } from './webhook.service';

/** GET /api/webhooks/meta — one-time subscription challenge (spec §16). */
export function verifyWebhookHandler(req: Request, res: Response): void {
  const result = verifyChallenge(req.query as Record<string, unknown>);

  if (!result.ok) {
    // Logged at warn so a failed subscription attempt is always visible in
    // the deployment's logs. Meta's dashboard reports every cause with the
    // same opaque message, so without this the operator is guessing.
    // Only the token's LENGTHS are logged, never the tokens themselves —
    // enough to spot "not set" or "pasted the wrong value" without putting
    // a shared secret into a log aggregator.
    const received = req.query['hub.verify_token'];
    logger.warn(
      {
        reason: result.reason,
        mode: req.query['hub.mode'],
        receivedTokenLength: typeof received === 'string' ? received.length : null,
        configuredTokenLength: env.META_VERIFY_TOKEN.length,
      },
      'Meta webhook verification failed',
    );

    res.status(403).json({
      success: false,
      error: { code: 'WEBHOOK_VERIFICATION_FAILED', message: 'Invalid verify token' },
    });
    return;
  }

  logger.info('Meta webhook verification succeeded');
  // Explicitly text/plain: Meta compares the response body to the challenge
  // byte-for-byte, so it must be the bare value with no JSON quoting and no
  // HTML content type sniffing around it.
  res.status(200).type('text/plain').send(result.challenge);
}

/**
 * GET /api/webhooks/meta/health — configuration self-check.
 *
 * Exists because the failure this diagnoses happens BEFORE any log line
 * from the handler above: Meta refuses to save a callback URL it cannot
 * verify, so the usual "check the logs after it breaks" loop needs
 * something to check first. Unauthenticated on purpose — the point is to
 * be curl-able against a fresh deployment before anyone can log in — and
 * so it reports only whether each secret is present and how long it is,
 * never any part of its value.
 */
export function webhookConfigHealthHandler(req: Request, res: Response): void {
  const host = req.get('host');
  res.status(200).json({
    success: true,
    data: {
      callbackUrl: host ? `${req.protocol}://${host}/api/webhooks/meta` : null,
      verifyTokenConfigured: env.META_VERIFY_TOKEN.length > 0,
      verifyTokenLength: env.META_VERIFY_TOKEN.length,
      appSecretConfigured: env.META_APP_SECRET.length > 0,
      appSecretLength: env.META_APP_SECRET.length,
      // false here is the single most common cause of a webhook that
      // arrives and 401s: some other Meta credential — usually an access
      // token, sometimes the App ID — pasted into the app-secret box.
      // A shape check, not a value; see appSecretHasExpectedShape.
      appSecretLooksLikeAnAppSecret: appSecretHasExpectedShape(),
      accessTokenConfigured: env.META_ACCESS_TOKEN.length > 0,
      // The two Embedded Signup needs. Reported here because the only
      // other way to find out one is missing is to install the app, open
      // Connect WhatsApp, and read it off the WebView — which is a long
      // way to travel for "you forgot an environment variable".
      appIdConfigured: env.META_APP_ID.length > 0,
      configIdConfigured: env.META_CONFIG_ID.length > 0,
      registerPinConfigured: env.META_REGISTER_PIN.length > 0,
      encryptionKeyConfigured: env.ENCRYPTION_KEY.length > 0,
      phoneNumberIdConfigured: env.META_PHONE_NUMBER_ID.length > 0,
      mockMode: env.META_MOCK_MODE,
      queueMode: isRedisConfigured() ? 'redis' : 'inline',
      // Reported here because there is otherwise no way to tell whether
      // push is live short of reading the deploy log — and by the time
      // someone is asking "why is no notification arriving", the log line
      // that would have answered it has usually scrolled away.
      pushConfigured: getPushGateway().isConfigured(),
    },
  });
}

/** POST /api/webhooks/meta — actual event delivery. */
export const receiveWebhookHandler = asyncHandler(async (req: Request, res: Response) => {
  const signatureHeader = req.headers['x-hub-signature-256'] as string | undefined;
  // Falls back to a re-serialized body only if raw-body capture somehow
  // didn't run (see app.ts's express.json `verify` option) — Meta always
  // sends a signature, so in practice this path only matters for tests that
  // post JSON without going through the raw-capturing middleware.
  const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

  const signature = checkSignature(rawBody, signatureHeader);
  if (!signature.ok) {
    // Logged rather than only returned, because this is the one failure
    // nobody can see from either side: Meta's dashboard reports a failed
    // delivery without a cause, and a 401 in the access log says nothing
    // about which of the five reasons it was. Every field here is a
    // boolean, a length, or a fixed enum — no secret, and no part of one.
    logger.warn(
      {
        reason: signature.reason,
        appSecretConfigured: Boolean(env.META_APP_SECRET),
        // A DIGEST_MISMATCH with a well-shaped secret means the wrong app's
        // secret; with a badly-shaped one it means a different Meta
        // credential was pasted into the box. See appSecretHasExpectedShape.
        appSecretLooksLikeAnAppSecret: appSecretHasExpectedShape(),
        rawBodyCaptured: req.rawBody !== undefined,
        bodyBytes: rawBody.length,
      },
      'Rejected a Meta webhook delivery: its signature did not verify',
    );
    throw ApiError.unauthorized('WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature');
  }

  // Meta expects a fast ack (well under its timeout) — process async via
  // BullMQ when Redis is available, otherwise process inline so the system
  // still functions (at the cost of a slower ack) in a Redis-less setup.
  if (isRedisConfigured()) {
    try {
      await enqueueWebhookDelivery(req.body);
    } catch (err) {
      // A configured-but-unreachable Redis used to fail the whole delivery,
      // which means Meta retries it and — while the outage lasts — every
      // inbound message fails. That is strictly worse than the inline path
      // this deployment ran on before Redis existed, so fall back to it
      // rather than dropping the customer's message on the floor.
      //
      // Logged at error, not warn: the queue silently not being used is the
      // kind of thing that goes unnoticed for weeks and then shows up as
      // "why is the server slow".
      logger.error({ err }, 'Could not enqueue the Meta webhook — processing it inline instead');
      await processWebhookDelivery(req.body);
    }
  } else {
    logger.warn('REDIS_URL not configured — processing Meta webhook inline instead of via queue');
    await processWebhookDelivery(req.body);
  }

  res.status(200).json({ success: true });
});
