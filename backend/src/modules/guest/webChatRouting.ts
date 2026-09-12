import type { GuestSessionDoc } from './guestSession.model';

/**
 * Which channel an agent's reply should go out on.
 *
 * The bug this was written for: a customer with the private window open
 * on their phone received every reply TWICE — once in the web window and
 * once in WhatsApp. The window got it because every outbound row is
 * emitted to the conversation room the guest socket has joined; WhatsApp
 * got it because the send went to Meta as well. Neither half was wrong on
 * its own, and nothing was deciding between them.
 *
 * The rule is the one the customer would expect: once they have actually
 * used the private window, that is where the conversation is, so that is
 * where replies go. Until then — and again if the link dies — WhatsApp.
 *
 * Kept as a pure function, separate from the send path, because getting
 * it wrong is invisible from the agent's side: the message looks sent
 * either way, and it is the customer who gets it twice or not at all.
 */
export type ReplyChannel = 'whatsapp' | 'web';

/**
 * How long after the customer's last visit the window still counts as
 * where they are reading.
 *
 * A guard against the one way this rule could strand someone: a customer
 * who opened the link once out of curiosity weeks ago, never came back,
 * and would otherwise have every reply routed to a page they are not
 * looking at. After this, replies go back to WhatsApp — still exactly one
 * channel, never both, just the one they are more likely to read.
 *
 * Seven days rather than hours: the window is a place a customer returns
 * to across a conversation that may run for days, and flipping channels
 * because they slept would be worse than either choice.
 */
const PRESENCE_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Opened, not merely issued.
 *
 * `lastSeenAt` is written on every authenticated guest request (see
 * resolveGuestContextFromToken), so it is set the moment the customer
 * opens the link — which is exactly the moment the conversation moves
 * there, whether or not they have typed anything yet.
 *
 * Deliberately not the link's mere existence: a link that was SENT is no
 * evidence anyone tapped it, and routing on that would deliver replies
 * into a window nobody ever opened. The customer would then hear nothing
 * at all, which is far worse than hearing it twice.
 */
export function hasMovedToWebChat(
  session: Pick<GuestSessionDoc, 'activatedAt' | 'blockedAt' | 'lastSeenAt'> | null,
  now: Date = new Date(),
): boolean {
  if (!session) return false;
  // A block is the customer shutting this window. It does not touch
  // WhatsApp, so WhatsApp is exactly where the reply must go instead —
  // routing to a blocked window would drop the message silently while the
  // agent watched it turn "sent".
  if (session.blockedAt) return false;

  // Either is evidence they opened it; lastSeenAt is the later of the two
  // whenever both exist, since writing in the window touches it too.
  const seenAt = session.lastSeenAt ?? session.activatedAt;
  if (!seenAt) return false;

  return now.getTime() - seenAt.getTime() < PRESENCE_STALE_AFTER_MS;
}

/**
 * The channel for one outbound message.
 *
 * A template is always WhatsApp, whatever the window is doing. Templates
 * exist only to reopen Meta's 24-hour window; the web window has no such
 * rule, so an agent choosing one has explicitly chosen WhatsApp, and
 * quietly rerouting it would leave them believing they had reopened a
 * window that is still shut.
 *
 * A demo contact is always WhatsApp too — meaning the mock gateway, since
 * that is the sandbox those chats already run in.
 */
export function resolveReplyChannel(
  input: {
    messageType: string;
    isDemoContact: boolean;
    session: Pick<GuestSessionDoc, 'activatedAt' | 'blockedAt' | 'lastSeenAt'> | null;
  },
  now: Date = new Date(),
): ReplyChannel {
  if (input.messageType === 'template') return 'whatsapp';
  if (input.isDemoContact) return 'whatsapp';
  return hasMovedToWebChat(input.session, now) ? 'web' : 'whatsapp';
}
