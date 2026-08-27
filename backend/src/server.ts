import { createApp } from './app';
import { connectMongo } from './lib/mongoose';
import { env } from './config/env';
import { logger } from './lib/logger';

async function main(): Promise<void> {
  await connectMongo();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'VOXO backend listening');
  });

  // Socket.IO gateway (Phase 4) and BullMQ workers (Phase 3+) attach to
  // this same HTTP server / process in later phases.

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => process.exit(0));
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
