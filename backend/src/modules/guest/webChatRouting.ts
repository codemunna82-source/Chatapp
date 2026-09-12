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
 * Opened, not merely issued.
 *
 * `activatedAt` is set the first time the customer WRITES in the window
 * (see guest.service.ts), which is the only evidence that they moved over
 * rather than that a link was sent to them. Routing on the link's mere
 * existence would send replies into a window nobody ever opened — the
 * customer would hear nothing at all, which is far worse than hearing it
 * twice.
 */
export function hasMovedToWebChat(session: Pick<GuestSessionDoc, 'activatedAt' | 'blockedAt'> | null): boolean {
  if (!session) return false;
  // A block is the customer shutting this window. It does not touch
  // WhatsApp, so WhatsApp is exactly where the reply must go instead —
  // routing to a blocked window would drop the message silently while the
  // agent watched it turn "sent".
  if (session.blockedAt) return false;
  return Boolean(session.activatedAt);
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
export function resolveReplyChannel(input: {
  messageType: string;
  isDemoContact: boolean;
  session: Pick<GuestSessionDoc, 'activatedAt' | 'blockedAt'> | null;
}): ReplyChannel {
  if (input.messageType === 'template') return 'whatsapp';
  if (input.isDemoContact) return 'whatsapp';
  return hasMovedToWebChat(input.session) ? 'web' : 'whatsapp';
}
