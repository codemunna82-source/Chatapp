import { createApp } from './app';
import { connectMongo } from './lib/mongoose';
import { env } from './config/env';
import { logger } from './lib/logger';
import { isRedisConfigured, closeRedisConnection } from './queues/connection';
import { startWebhookWorker, stopWebhookWorker } from './queues/webhook.queue';

async function main(): Promise<void> {
  await connectMongo();

  if (isRedisConfigured()) {
    startWebhookWorker();
    logger.info('Webhook processing worker started (BullMQ + Redis)');
  } else {
    logger.warn('REDIS_URL not configured — webhook deliveries will be processed inline, not queued');
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'VOXO backend listening');
  });

  // Socket.IO gateway attaches to this same HTTP server in Phase 4.

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      Promise.all([stopWebhookWorker(), closeRedisConnection()])
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
