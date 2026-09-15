import type { Message } from '../../api/types';

/**
 * How long after sending a message can still be withdrawn from the
 * customer's screen.
 *
 * The server holds the real rule and is the only thing enforcing it; this
 * copy exists so the app does not offer a button that is going to come
 * back refused. A minute short of the server's hour, so a tap at the very
 * edge is not lost to clock skew between a phone and the server.
 */
const REVOKE_WINDOW_MS = 59 * 60 * 1000;

/**
 * Whether "Delete for everyone" belongs on this message.
 *
 * Three things have to hold, and each one is a different apology if it
 * does not: it has to be ours to unsend, it has to have gone out on the
 * private web chat rather than through Meta, and it has to be recent.
 */
export function canDeleteForEveryone(message: Message, now = Date.now()): boolean {
  if (message.direction !== 'OUT') return false;
  if (message.revokedAt) return false;
  // Absent means an older row, which is read as WhatsApp — see the type.
  if (message.channel !== 'web') return false;
  const sent = Date.parse(message.createdAt);
  return Number.isFinite(sent) && now - sent <= REVOKE_WINDOW_MS;
}

/**
 * What the tombstone says, from this workspace's point of view.
 *
 * "You" means this workspace, not the agent who tapped it: a shared
 * inbox has several people in it and naming one of them on a bubble
 * every colleague can see would be new information nobody asked for.
 * Whoever did it is in the audit log.
 */
export function revokedLine(message: Message): string {
  if (message.revokedBy === 'agent') return 'You deleted this message';
  return 'This message was deleted';
}
