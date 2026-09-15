import type { MessageChannel, MessageRevoker } from './message.model';

/**
 * The rules that decide whether a message can be unsent.
 *
 * Pure, and in their own file, because they are the part of "delete for
 * everyone" that is actually easy to get wrong: allow a WhatsApp message
 * through and the agent's screen disagrees with the customer's phone,
 * with no way back. Kept away from the database so they can be tested
 * exhaustively, which the service around them cannot be here.
 */

/**
 * How long after sending a message can still be withdrawn.
 *
 * An hour. WhatsApp allows about two days, but this is a business inbox
 * rather than a private chat: a message the customer has already read,
 * acted on and possibly quoted in an email is not something a workspace
 * should be able to make vanish, and the honest use for this — "that
 * went to the wrong person", "that price was wrong" — happens within
 * minutes. Long enough to fix a mistake, short enough not to be a way of
 * editing history.
 */
export const REVOKE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Which wire a message travelled on.
 *
 * Rows written before the `channel` field existed have no value, so the
 * fallback is Meta's own message id: a message that has a wamid went
 * through Meta and is therefore beyond recall, and one that does not
 * either stayed inside this app or never left it at all. Wrong only in
 * the safe direction — an outbound WhatsApp message that failed before
 * Meta answered has no wamid and would be treated as revocable, which
 * withdraws a message nobody ever received.
 */
export function messageChannel(message: {
  channel?: MessageChannel | null;
  metaMessageId?: string | null;
}): MessageChannel {
  return message.channel ?? (message.metaMessageId ? 'whatsapp' : 'web');
}

export type RevokeRefusal =
  | 'NOT_WEB_CHANNEL'
  | 'NOT_YOURS'
  | 'WINDOW_PASSED'
  | 'ALREADY_REVOKED';

export interface RevokeCandidate {
  channel?: MessageChannel | null;
  metaMessageId?: string | null;
  /** IN is the customer's, OUT is the workspace's. */
  direction: 'IN' | 'OUT';
  createdAt: Date;
  revokedAt?: Date | null;
}

/**
 * Null when the message may be withdrawn, or the reason it may not.
 *
 * A reason rather than a boolean so each side can say what is actually
 * wrong — "this was sent on WhatsApp and cannot be unsent" and "it has
 * been too long" send someone to very different places.
 */
export function refusalToRevoke(
  message: RevokeCandidate,
  by: MessageRevoker,
  now: Date = new Date(),
): RevokeRefusal | null {
  if (message.revokedAt) return 'ALREADY_REVOKED';

  // Meta exposes no delete or recall. Nothing else in this function can
  // rescue that, so it is checked first.
  if (messageChannel(message) !== 'web') return 'NOT_WEB_CHANNEL';

  // You can unsend what you sent, and nothing else. An agent removing a
  // customer's message from the customer's own screen is not a delete,
  // it is editing someone else's record of the conversation — and the
  // reverse would let a customer erase what a business told them.
  const ownIt = by === 'agent' ? message.direction === 'OUT' : message.direction === 'IN';
  if (!ownIt) return 'NOT_YOURS';

  if (now.getTime() - message.createdAt.getTime() > REVOKE_WINDOW_MS) return 'WINDOW_PASSED';

  return null;
}

/** What each side is told when a refusal comes back. */
export const REVOKE_REFUSAL_MESSAGE: Record<RevokeRefusal, string> = {
  NOT_WEB_CHANNEL: 'This message went out on WhatsApp and cannot be unsent. You can still delete it for yourself.',
  NOT_YOURS: 'You can only delete your own messages for everyone.',
  WINDOW_PASSED: 'It has been too long to delete this for everyone. You can still delete it for yourself.',
  ALREADY_REVOKED: 'That message has already been deleted.',
};
