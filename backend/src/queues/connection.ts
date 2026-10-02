import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../lib/logger';

let connection: Redis | null = null;

/**
 * Collapses a reconnect storm into one log line every so often.
 *
 * ioredis retries forever (maxRetriesPerRequest: null, which BullMQ
 * requires), and every attempt emits an `error`. With Redis down that is
 * several identical lines per second from each of the shared, blocking and
 * adapter connections at once — thousands of lines that say one thing, and
 * which bury the lines that explain what is actually wrong. The first
 * failure is logged immediately, repeats are counted, and recovery is
 * logged too so the log says when it ended, not just that it started.
 *
 * This throttles the reporting, not the retrying: nothing is swallowed and
 * no error is hidden — the count of suppressed repeats is printed with it.
 */
const ERROR_LOG_INTERVAL_MS = 30_000;

function attachThrottledErrorLog(client: Redis, label: string): void {
  let lastLoggedAt = 0;
  let suppressed = 0;
  let down = false;

  client.on('error', (err) => {
    down = true;
    const now = Date.now();
    if (now - lastLoggedAt < ERROR_LOG_INTERVAL_MS) {
      suppressed += 1;
      return;
    }
    lastLoggedAt = now;
    logger.error({ err, label, suppressedRepeats: suppressed }, 'Redis connection error — retrying');
    suppressed = 0;
  });

  client.on('ready', () => {
    if (!down) return;
    down = false;
    lastLoggedAt = 0;
    suppressed = 0;
    logger.info({ label }, 'Redis connection recovered');
  });
}

/** Throws if REDIS_URL isn't configured — callers decide whether that's fatal or a fallback trigger. */
export function getRedisConnection(): Redis {
  if (!env.REDIS_URL) {
    throw new Error('REDIS_URL is not configured');
  }
  if (!connection) {
    // maxRetriesPerRequest: null is required by BullMQ's blocking connections.
    connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    attachThrottledErrorLog(connection, 'shared');
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
  attachThrottledErrorLog(duplicated, 'blocking');
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
