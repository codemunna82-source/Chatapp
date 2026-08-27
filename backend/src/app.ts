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
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(requestLogger);

  // Health/readiness are unauthenticated and unthrottled — orchestrators
  // poll these frequently and must never be rate-limited.
  app.use(healthRouter);

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

  app.use('/api', apiRateLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', userRouter);

  // Meta webhook routes are added in Phase 3 (src/integrations/meta) and
  // deliberately bypass JWT auth (Meta signs requests differently — see
  // webhookVerifier.ts), so they are not mounted under the generic
  // requireAuth-protected API surface above.

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
