import { Router } from 'express';
import { webhookRateLimiter } from '../../middleware/rateLimit.middleware';
import {
  verifyWebhookHandler,
  receiveWebhookHandler,
  webhookConfigHealthHandler,
} from './webhook.controller';

export const webhookRouter = Router();

// Registered before '/meta' so the more specific path wins regardless of
// how Express orders same-prefix routes.
webhookRouter.get('/meta/health', webhookRateLimiter, webhookConfigHealthHandler);

// Deliberately NOT behind requireAuth — Meta authenticates itself via the
// verify-token challenge (GET) and the HMAC signature (POST), not a JWT.
webhookRouter.get('/meta', webhookRateLimiter, verifyWebhookHandler);
webhookRouter.post('/meta', webhookRateLimiter, receiveWebhookHandler);
