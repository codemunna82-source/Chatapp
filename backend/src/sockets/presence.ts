import { logger } from '../lib/logger';
import { agentsRoom, guestPresenceRoom } from './rooms';
import type { AppServer } from './types';

/**
 * Whether anyone from the business is currently connected, and telling the
 * customers who are waiting.
 *
 * Counted from live socket membership rather than a flag on a document:
 * a stored "online" boolean survives a crashed process, a lost network and
 * a killed app, and then tells a customer someone is there when nobody is.
 * Room membership cannot lie about that — a dropped socket leaves the room
 * whether or not anything got to run.
 *
 * fetchSockets() goes through the Redis adapter when one is configured, so
 * this counts every instance of a scaled deployment, not just this one.
 */
export async function countOnlineAgents(io: AppServer, tenantId: string): Promise<number> {
  try {
    const sockets = await io.in(agentsRoom(tenantId)).fetchSockets();
    return sockets.length;
  } catch (err) {
    // Never fail a connection over presence. A customer seeing "offline"
    // when the count could not be taken is a cosmetic loss; a socket that
    // refused to connect is not.
    logger.warn({ err, tenantId }, 'Could not count online agents');
    return 0;
  }
}

/** Pushes the current state to every customer watching this workspace. */
export async function broadcastAgentPresence(io: AppServer, tenantId: string): Promise<void> {
  const online = (await countOnlineAgents(io, tenantId)) > 0;
  io.to(guestPresenceRoom(tenantId)).emit('agent:presence', { online });
}
