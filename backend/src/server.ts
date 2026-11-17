// MUST be first: Sentry instruments Express, Mongoose and http by patching
// them at require time, so anything imported above this line runs untraced.
import './instrument';

import { createServer } from 'node:http';
import { createApp } from './app';
import { connectMongo } from './lib/mongoose';
import { env } from './config/env';
import { hasTurnConfigured } from './modules/calls/webCall.service';
import { getPushGateway } from './integrations/fcm';
import { logger } from './lib/logger';
import { isRedisConfigured, closeRedisConnection } from './queues/connection';
import { startWebhookWorker, stopWebhookWorker } from './queues/webhook.queue';
import {
  startSubscriptionExpiryWorker,
  stopSubscriptionExpiryWorker,
  scheduleSubscriptionExpirySweep,
} from './queues/subscriptionExpiry.queue';
import { startMessageRetryWorker, stopMessageRetryWorker } from './queues/messageRetry.queue';
import { startOutboundDispatchWorker, stopOutboundDispatchWorker } from './queues/outboundDispatch.queue';
import {
  startAutomaticInviteDispatchWorker,
  stopAutomaticInviteDispatchWorker,
} from './queues/automaticInviteDispatch.queue';
import { startSocketServer, stopSocketServer } from './sockets/socketServer';
import { migrateWabaIndexAtBoot } from './modules/whatsapp/wabaIndexMigration';
import { migrateConversationNumberIndexAtBoot } from './modules/conversations/conversationNumberIndexMigration';
import { domainPool } from './modules/tenants/guestDomain.service';
import { encryptionKeyStatus } from './lib/crypto';

/**
 * What this deployment can and cannot do, said once at boot.
 *
 * A missing integration key does not stop the server starting — that is
 * deliberate, since a workspace with no Firebase should still serve chats
 * — but it means the feature is silently off, and the failure surfaces
 * hours later as "messages never arrive" with nothing in the logs to
 * explain it. One line at startup turns that into something an operator
 * can see before they go looking.
 *
 * Booleans only. Never a value, never a length, never a prefix: this ends
 * up in a log aggregator, and a secret in a log is a secret published.
 */
function logConfigReadiness(): void {
  logger.info(
    {
      metaLive: !env.META_MOCK_MODE,
      metaAccessToken: env.META_ACCESS_TOKEN.length > 0,
      metaAppSecret: env.META_APP_SECRET.length > 0,
      metaVerifyToken: env.META_VERIFY_TOKEN.length > 0,
      metaAppId: env.META_APP_ID.length > 0,
      metaRegisterPin: env.META_REGISTER_PIN.length > 0,
      guestLinkBaseUrl: env.GUEST_LINK_BASE_URL.length > 0,
      // A count, not the domains: how many spare chat domains a workspace
      // can be moved onto, which is the number that says whether the
      // isolation this exists for is actually available.
      guestLinkDomainPool: domainPool().length,
      pushFcm: getPushGateway().isConfigured(),
      turn: hasTurnConfigured(),
      cloudinary: Boolean(env.CLOUDINARY_URL),
      // Usable, not merely set. A key of the wrong length fails only at
      // the first encrypt — which is a 500 on whichever admin action
      // happened to reach it first, hours or weeks after the deploy that
      // caused it. Printing it at boot puts the answer above the failure.
      encryptionKeyUsable: encryptionKeyStatus().usable,
    },
    'Integration readiness — false means that feature is off, not that the server is broken',
  );
}

async function main(): Promise<void> {
  await connectMongo();

  // Runs here rather than as a deploy step someone has to remember: the
  // failure it prevents only shows up when a second workspace onboards the
  // same WhatsApp Business Account, which is exactly the moment nobody is
  // thinking about indexes. Idempotent, and never fatal.
  await migrateWabaIndexAtBoot();

  // Same reasoning, different index: the constraint being replaced is the
  // one that files a customer's message to a second WhatsApp number into
  // the first number's thread. Idempotent, and never fatal.
  await migrateConversationNumberIndexAtBoot();

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
    logConfigReadiness();
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    httpServer.close(() => {
      Promise.all([
        stopSocketServer(),
        stopWebhookWorker(),
        stopSubscriptionExpiryWorker(),
        stopMessageRetryWorker(),
        stopOutboundDispatchWorker(),
        stopAutomaticInviteDispatchWorker(),
        closeRedisConnection(),
      ])
        .catch((err) => logger.error({ err }, 'Error during shutdown'))
        .finally(() => process.exit(0));
    });
    // Force-exit if graceful shutdown hangs.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Deliberately after listen(), and deliberately not awaited.
  //
  // These need Redis, and the shared connection is built with
  // maxRetriesPerRequest: null because BullMQ requires it of a blocking
  // connection — which means a command issued while Redis is unreachable
  // never resolves and never rejects, it just waits. Awaiting one of them
  // on the boot path therefore does not fail the deploy with an error: it
  // hangs before the port is ever bound, and the platform eventually gives
  // up waiting for a listener that was one `await` away. That is exactly
  // how a suspended Redis instance took this service down for three
  // deploys in a row, with a green build and nothing in the log but
  // ECONNREFUSED.
  //
  // Queued webhook processing and the hourly sweep are both background
  // concerns. Neither is allowed to decide whether this process serves
  // HTTP, and both pick up on their own once Redis answers again.
  startBackgroundQueues();
}

/**
 * Starts the Redis-backed background workers, reporting rather than
 * throwing.
 *
 * Not async on purpose: nothing here is safe to await on a path that must
 * reach a bound port (see the call site). A sweep that never gets scheduled
 * delays a notification; it can never grant access, because the auth
 * middleware does its own live validity check and never reads the cached
 * subscription status.
 */
function startBackgroundQueues(): void {
  if (!isRedisConfigured()) {
    logger.warn('REDIS_URL not configured — webhook deliveries will be processed inline, not queued');
    logger.warn(
      'REDIS_URL not configured — subscription expiry sweep will not run (auth middleware stays authoritative regardless)',
    );
    logger.warn('REDIS_URL not configured — a rate-limited reply will not be auto-retried; an agent must tap retry');
    logger.warn('REDIS_URL not configured — outbound WhatsApp sends will not be globally paced');
    logger.warn(
      'REDIS_URL not configured — an automatic invitation skipped for pacing will be dropped instead of retried',
    );
    return;
  }

  startWebhookWorker();
  logger.info('Webhook processing worker started (BullMQ + Redis)');
  startSubscriptionExpiryWorker();
  startMessageRetryWorker();
  logger.info('Message rate-limit retry worker started (BullMQ + Redis)');
  startOutboundDispatchWorker();
  logger.info('Outbound dispatch (global send pacing) worker started (BullMQ + Redis)');
  startAutomaticInviteDispatchWorker();
  logger.info('Automatic invite dispatch (deferred invitation retry) worker started (BullMQ + Redis)');

  // The .catch is for a genuine rejection (a malformed REDIS_URL, say).
  // An unreachable Redis does not reject — it stays pending until the
  // server is back, and the sweep is scheduled then.
  scheduleSubscriptionExpirySweep()
    .then(() => logger.info('Subscription expiry sweep scheduled (hourly, BullMQ + Redis)'))
    .catch((err) => logger.error({ err }, 'Could not schedule the subscription expiry sweep'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
