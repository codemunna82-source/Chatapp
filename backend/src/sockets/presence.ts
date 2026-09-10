import { logger } from '../lib/logger';
import { agentsRoom, conversationRoom, guestPresenceRoom, phoneNumberRoom, tenantRoom } from './rooms';
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

/**
 * Whether the customer has their web chat window open, told to the agents
 * who may see that conversation.
 *
 * The mirror of the presence above, and it was missing: a customer could
 * tap "Open private chat", land in the window and sit there, and nothing
 * on the business's side said so. The agent found out when a message
 * arrived, which is one turn too late to be waiting for someone.
 *
 * Addressed to the tenant and number rooms rather than the conversation
 * room, and that matters: the conversation room only holds agents who
 * already have that chat open, which is exactly the set who do not need
 * telling. The people who need to know are the ones looking at the list.
 */
export function broadcastGuestPresence(
  io: AppServer,
  guest: { tenantId: string; conversationId: string; whatsappPhoneNumberId: string },
  online: boolean,
): void {
  io.to(tenantRoom(guest.tenantId))
    .to(phoneNumberRoom(guest.whatsappPhoneNumberId))
    .emit('guest:presence', { conversationId: guest.conversationId, online });
}

/**
 * How many customer sockets are still in this conversation.
 *
 * Counted before announcing a departure because one customer can have the
 * window open in two tabs, and closing one of them is not them leaving.
 * Filtered to guests: an agent with the chat open is in the same room.
 */
export async function countGuestSockets(io: AppServer, conversationId: string): Promise<number> {
  try {
    const sockets = await io.in(conversationRoom(conversationId)).fetchSockets();
    return sockets.filter((s) => Boolean((s.data as { guest?: unknown }).guest)).length;
  } catch (err) {
    logger.warn({ err, conversationId }, 'Could not count guest sockets');
    // Zero means "announce them as gone", which is the safer wrong answer:
    // an agent told nobody is there goes back to the list, where the next
    // message will still reach them.
    return 0;
  }
}
