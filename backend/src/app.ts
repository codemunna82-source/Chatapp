import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { openApiSpec } from './docs/openapi';
import { requestLogger } from './middleware/requestLogger.middleware';
import { apiRateLimiter } from './middleware/rateLimit.middleware';
import { errorHandler } from './middleware/errorHandler.middleware';
import { notFoundHandler } from './middleware/notFound.middleware';
import { healthRouter } from './modules/health/health.routes';
import { authRouter } from './modules/auth/auth.routes';
import { userRouter } from './modules/users/user.routes';
import { webhookRouter } from './modules/webhooks/webhook.routes';
import { contactRouter } from './modules/contacts/contact.routes';
import { conversationRouter } from './modules/conversations/conversation.routes';
import { mediaRouter } from './modules/media/media.routes';
import { messageTemplateRouter } from './modules/templates/messageTemplate.routes';
import { walletRouter } from './modules/wallet/wallet.routes';
import { notificationRouter } from './modules/notifications/notification.routes';
import { subscriptionRouter } from './modules/subscriptions/subscription.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { callRouter } from './modules/calls/call.routes';
import { quickReplyRouter } from './modules/quickReplies/quickReply.routes';
import { deviceRouter } from './modules/devices/deviceToken.routes';
import { Sentry, isSentryEnabled, isReportableError } from './lib/sentry';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // needed for correct req.ip behind a reverse proxy/load balancer

  // gzip before anything writes a body. The API's payloads are JSON lists
  // of highly repetitive documents — a page of conversations or messages
  // compresses to roughly a quarter of its size, which on a phone on
  // mobile data is the single largest factor in how long a screen takes to
  // appear.
  //
  // `compression` consults the `compressible` table, so already-compressed
  // media (JPEG, MP4, audio) passing through the media proxy is left
  // alone rather than being re-compressed for nothing.
  app.use(compression());

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
    }),
  );
  app.use(
    express.json({
      limit: '2mb',
      // Captures the exact wire bytes onto req.rawBody — required to verify
      // Meta's X-Hub-Signature-256 HMAC, which is computed over the raw
      // body, not a re-serialized JSON.parse'd/stringify'd copy of it.
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(requestLogger);

  // Health/readiness are unauthenticated and unthrottled — orchestrators
  // poll these frequently and must never be rate-limited.
  app.use(healthRouter);

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

  // Meta webhook routes are mounted BEFORE the generic '/api' rate limiter
  // and never behind requireAuth — Meta authenticates itself via the
  // verify-token challenge (GET) and HMAC signature (POST), not a JWT, and
  // carries its own deliberately-generous limiter (see webhook.routes.ts).
  app.use('/api/webhooks', webhookRouter);

  app.use('/api', apiRateLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', userRouter);
  app.use('/api/contacts', contactRouter);
  app.use('/api/conversations', conversationRouter);
  app.use('/api/media', mediaRouter);
  app.use('/api/templates', messageTemplateRouter);
  app.use('/api/wallet', walletRouter);
  app.use('/api/notifications', notificationRouter);
  app.use('/api/subscription', subscriptionRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/calls', callRouter);
  app.use('/api/quick-replies', quickReplyRouter);
  app.use('/api/devices', deviceRouter);

  app.use(notFoundHandler);

  // Between the routes and the response shaper, and that order is the
  // whole point: Sentry's handler must see the error after every route has
  // had its chance to throw, but before errorHandler turns it into a JSON
  // body and ends the response.
  //
  // shouldHandleError filters to genuine failures. Without it the project
  // fills with expected 4xx outcomes — a closed 24-hour window, a contact
  // that was deleted, an expired token — and the real 500s become
  // impossible to find.
  if (isSentryEnabled()) {
    Sentry.setupExpressErrorHandler(app, { shouldHandleError: isReportableError });
  }

  app.use(errorHandler);

  return app;
}
