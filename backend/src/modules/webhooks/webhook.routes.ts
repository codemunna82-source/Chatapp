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
//
// Two shapes, and the pair is the point. The bare path uses the global
// META_* configuration and is what the original single-Business-Manager
// deployment is already configured with in Meta's dashboard; breaking it
// to add multi-BM support would have taken a working system down to
// deliver a feature it was not using.
//
// The :ref form names one Meta app, which is how a workspace spanning
// several Business Managers verifies anything at all: Meta signs each
// delivery with the secret of the app subscribed to that WABA, and the
// URL is the only part of the request that can be trusted before the
// signature is checked. See metaApp.model.ts.
webhookRouter.get('/meta', webhookRateLimiter, verifyWebhookHandler);
webhookRouter.post('/meta', webhookRateLimiter, receiveWebhookHandler);
webhookRouter.get('/meta/app/:ref', webhookRateLimiter, verifyWebhookHandler);
webhookRouter.post('/meta/app/:ref', webhookRateLimiter, receiveWebhookHandler);
