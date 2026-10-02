import { Queue } from 'bullmq';
import Redis from 'ioredis';

/**
 * The guard that keeps a dead Redis from taking inbound messaging down.
 *
 * Runs against a closed port, which is exactly what a suspended Redis
 * instance looks like. No mocking: the behaviour being pinned belongs to
 * ioredis and BullMQ, not to us, and a mock would assert our idea of them
 * rather than what they do.
 */

// Nothing listens here, so every connect is refused.
const DEAD_REDIS = 'redis://127.0.0.1:6399';

describe('enqueueing a webhook when Redis is unreachable', () => {
  let connection: Redis;
  let queue: Queue;

  beforeAll(() => {
    connection = new Redis(DEAD_REDIS, { maxRetriesPerRequest: null });
    connection.on('error', () => {
      // Expected, continuously. Swallowed so the suite's output stays readable.
    });
    queue = new Queue('enqueue-timeout-test', { connection });
  });

  afterAll(() => {
    // disconnect() first and without awaiting anything: it stops ioredis
    // reconnecting immediately, where queue.close() would talk to Redis
    // and hang against a dead one exactly as add() does. The pending add()
    // this suite deliberately leaves behind then has nothing to retry on,
    // so Jest is free to exit.
    connection.disconnect();
    void queue.close().catch(() => undefined);
  });

  it('never settles on its own — which is the whole problem', async () => {
    const add = queue.add('process', {});
    // Floated so an eventual rejection cannot fail the run after the test.
    add.catch(() => undefined);

    const outcome = await Promise.race([
      add.then(() => 'settled' as const).catch(() => 'settled' as const),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 3000)),
    ]);

    // If this ever fails, BullMQ has started rejecting and the timeout
    // below is no longer load-bearing.
    expect(outcome).toBe('pending');
  }, 10_000);

  it('rejects once bounded by a timeout, so a caller can fall back', async () => {
    const TIMEOUT_MS = 300;
    const add = queue.add('process', {});
    add.catch(() => undefined);

    const bounded = Promise.race([
      add,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('Redis did not accept the webhook')), TIMEOUT_MS),
      ),
    ]);

    await expect(bounded).rejects.toThrow(/did not accept/);
  }, 10_000);
});
