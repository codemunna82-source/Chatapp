import { Router } from 'express';
import { webhookRateLimiter } from '../../middleware/rateLimit.middleware';
import { verifyWebhookHandler, receiveWebhookHandler } from './webhook.controller';

export const webhookRouter = Router();

// Deliberately NOT behind requireAuth — Meta authenticates itself via the
// verify-token challenge (GET) and the HMAC signature (POST), not a JWT.
webhookRouter.get('/meta', webhookRateLimiter, verifyWebhookHandler);
webhookRouter.post('/meta', webhookRateLimiter, receiveWebhookHandler);
