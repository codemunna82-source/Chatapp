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

export function isRedisConfigured(): boolean {
  return Boolean(env.REDIS_URL);
}

export async function closeRedisConnection(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
