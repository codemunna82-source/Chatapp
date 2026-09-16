import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../lib/logger';

let connection: Redis | null = null;

/** Throws if REDIS_URL isn't configured — callers decide whether that's fatal or a fallback trigger. */
export function getRedisConnection(): Redis {
  if (!env.REDIS_URL) {
    throw new Error('REDIS_URL is not configured');
  }
  if (!connection) {
    // maxRetriesPerRequest: null is required by BullMQ's blocking connections.
    connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    connection.on('error', (err) => logger.error({ err }, 'Redis connection error'));
  }
  return connection;
}

/**
 * A connection of its own, for anything that blocks.
 *
 * BullMQ Workers wait on Redis with blocking commands, and a connection
 * parked in one cannot serve anything else. Sharing the single instance
 * above between a Queue and a Worker therefore does not merely contend —
 * it stops the Worker consuming while the Queue keeps accepting, which
 * looks exactly like a webhook that returns 200 and is never processed.
 * BullMQ's own documentation says not to share, and this is the shape of
 * the bug it means.
 *
 * ioredis's duplicate() copies the options, so maxRetriesPerRequest stays
 * null — which BullMQ requires of a blocking connection.
 */
export function createBlockingRedisConnection(): Redis {
  const duplicated = getRedisConnection().duplicate();
  duplicated.on('error', (err) => logger.error({ err }, 'Redis connection error (blocking)'));
  return duplicated;
}

export function isRedisConfigured(): boolean {
  return Boolean(env.REDIS_URL);
}

export async function closeRedisConnection(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
