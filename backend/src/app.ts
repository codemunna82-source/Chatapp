import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
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

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // needed for correct req.ip behind a reverse proxy/load balancer

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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
