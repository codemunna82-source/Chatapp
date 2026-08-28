import { createServer } from 'node:http';
import { createApp } from './app';
import { connectMongo } from './lib/mongoose';
import { env } from './config/env';
import { logger } from './lib/logger';
import { isRedisConfigured, closeRedisConnection } from './queues/connection';
import { startWebhookWorker, stopWebhookWorker } from './queues/webhook.queue';
import {
  startSubscriptionExpiryWorker,
  stopSubscriptionExpiryWorker,
  scheduleSubscriptionExpirySweep,
} from './queues/subscriptionExpiry.queue';
import { startSocketServer, stopSocketServer } from './sockets/socketServer';

async function main(): Promise<void> {
  await connectMongo();

  if (isRedisConfigured()) {
    startWebhookWorker();
    logger.info('Webhook processing worker started (BullMQ + Redis)');
    startSubscriptionExpiryWorker();
    await scheduleSubscriptionExpirySweep();
    logger.info('Subscription expiry sweep worker started (hourly, BullMQ + Redis)');
  } else {
    logger.warn('REDIS_URL not configured — webhook deliveries will be processed inline, not queued');
    logger.warn('REDIS_URL not configured — subscription expiry sweep will not run (auth middleware stays authoritative regardless)');
  }

  // Surfaced at boot, not on first failure: Meta refuses to save a callback
  // URL whose challenge fails, so a missing verify token has to be visible
  // in the deploy log before anyone tries to subscribe the webhook.
  if (!env.META_VERIFY_TOKEN) {
    logger.warn(
      'META_VERIFY_TOKEN is not set — Meta webhook verification (GET /api/webhooks/meta) will reject every request',
    );
  }
  if (!env.META_APP_SECRET) {
    logger.warn(
      'META_APP_SECRET is not set — signed Meta webhook deliveries (POST /api/webhooks/meta) will be rejected',
    );
  }

  const app = createApp();
  // A plain http.Server (not app.listen()'s implicit one) so Socket.IO can
  // attach to the exact same server/port — REST and WebSocket traffic share
  // one listener, per architecture doc §1.
  const httpServer = createServer(app);
  startSocketServer(httpServer);

  httpServer.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'VOXO backend listening (HTTP + Socket.IO)');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    httpServer.close(() => {
      Promise.all([stopSocketServer(), stopWebhookWorker(), stopSubscriptionExpiryWorker(), closeRedisConnection()])
        .catch((err) => logger.error({ err }, 'Error during shutdown'))
        .finally(() => process.exit(0));
    });
    // Force-exit if graceful shutdown hangs.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
