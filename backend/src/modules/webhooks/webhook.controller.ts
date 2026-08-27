import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { ApiError } from '../../lib/ApiError';
import { logger } from '../../lib/logger';
import { verifyChallenge, verifySignature } from '../../integrations/meta/webhookVerifier';
import { enqueueWebhookDelivery } from '../../queues/webhook.queue';
import { isRedisConfigured } from '../../queues/connection';
import { processWebhookDelivery } from './webhook.service';

/** GET /api/webhooks/meta — one-time subscription challenge (spec §16). */
export function verifyWebhookHandler(req: Request, res: Response): void {
  const challenge = verifyChallenge(req.query as Record<string, unknown>);
  if (challenge === null) {
    res.status(403).json({
      success: false,
      error: { code: 'WEBHOOK_VERIFICATION_FAILED', message: 'Invalid verify token' },
    });
    return;
  }
  res.status(200).send(challenge);
}

/** POST /api/webhooks/meta — actual event delivery. */
export const receiveWebhookHandler = asyncHandler(async (req: Request, res: Response) => {
  const signatureHeader = req.headers['x-hub-signature-256'] as string | undefined;
  // Falls back to a re-serialized body only if raw-body capture somehow
  // didn't run (see app.ts's express.json `verify` option) — Meta always
  // sends a signature, so in practice this path only matters for tests that
  // post JSON without going through the raw-capturing middleware.
  const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

  if (!verifySignature(rawBody, signatureHeader)) {
    throw ApiError.unauthorized('WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature');
  }

  // Meta expects a fast ack (well under its timeout) — process async via
  // BullMQ when Redis is available, otherwise process inline so the system
  // still functions (at the cost of a slower ack) in a Redis-less setup.
  if (isRedisConfigured()) {
    await enqueueWebhookDelivery(req.body);
  } else {
    logger.warn('REDIS_URL not configured — processing Meta webhook inline instead of via queue');
    await processWebhookDelivery(req.body);
  }

  res.status(200).json({ success: true });
});
