import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { getPushGateway } from '../../integrations/fcm';
import { previewForMessage } from '../notifications/push.service';
import {
  deleteGuestPushTokens,
  listGuestPushTokens,
} from './guestPushToken.repository';

/**
 * Notifications to the CUSTOMER's browser, not to the workspace.
 *
 * Its own module rather than more functions in push.service, because the
 * two have opposite audiences and the mistake they can make is the same
 * mistake in both directions: a message meant for the customer landing on
 * an agent's lock screen, or a customer being sent a notification about
 * their own message. Keeping the recipient lookup in separate files means
 * neither can reach for the other's query by accident.
 *
 * Nothing here throws. Every caller has already stored the message and
 * emitted it over the socket, and a push that fails must not undo work
 * that has genuinely happened.
 */

/** Where a tapped notification should open. */
function chatLink(token?: string): string | undefined {
  if (!env.GUEST_LINK_BASE_URL || !token) return undefined;
  return `${env.GUEST_LINK_BASE_URL}/c/${token}`;
}

async function sendToGuest(
  tenantId: string,
  conversationId: string,
  payload: {
    title: string;
    body: string;
    collapseKey: string;
    data: Record<string, string>;
    link?: string;
    requireInteraction?: boolean;
  },
): Promise<void> {
  const gateway = getPushGateway();
  if (!gateway.isConfigured()) return;

  try {
    const rows = await listGuestPushTokens(tenantId, conversationId);
    if (rows.length === 0) return;

    const result = await gateway.send(
      rows.map((r) => r.token),
      payload,
    );

    if (result.invalidTokens.length > 0) {
      await deleteGuestPushTokens(result.invalidTokens);
    }
  } catch (err) {
    logger.error({ err, conversationId }, 'Guest push failed — the message itself was unaffected');
  }
}

export interface GuestMessagePushInput {
  tenantId: string;
  conversationId: string;
  /** The business the customer is talking to — what they will see as the sender. */
  businessName: string;
  messageType: string;
  text?: string;
  /**
   * The link token, so tapping the notification opens this chat.
   *
   * Optional because the plaintext token is only held where it is already
   * known. Without it the notification still shows and still says who it
   * is from; tapping it just focuses whatever tab is open rather than
   * opening a new one.
   */
  linkToken?: string;
}

/** The business replied in the web window. */
export async function pushGuestMessage(input: GuestMessagePushInput): Promise<void> {
  await sendToGuest(input.tenantId, input.conversationId, {
    title: input.businessName,
    body: previewForMessage(input.messageType, input.text),
    // One conversation, one notification: a burst of replies replaces
    // itself rather than filling the shade.
    collapseKey: `guest:${input.conversationId}`,
    data: {
      type: 'message',
      conversationId: input.conversationId,
    },
    link: chatLink(input.linkToken),
  });
}

export interface GuestCallPushInput {
  tenantId: string;
  conversationId: string;
  businessName: string;
  callId: string;
  linkToken?: string;
}

/**
 * The business is ringing the web window.
 *
 * Its own collapse key so it can never replace — or be replaced by — an
 * unread message notification for the same chat, and requireInteraction so
 * it stays on screen: a ring that fades after four seconds is a missed
 * call the customer never knew about.
 *
 * This is a notification ABOUT a call, not a call screen. Tapping it opens
 * the chat, where the actual ring is waiting on the socket. A browser
 * notification cannot answer a call and should not pretend to.
 */
export async function pushGuestIncomingCall(input: GuestCallPushInput): Promise<void> {
  await sendToGuest(input.tenantId, input.conversationId, {
    title: input.businessName,
    body: '📞 Incoming voice call — tap to answer',
    collapseKey: `guest:${input.conversationId}:call`,
    requireInteraction: true,
    data: {
      type: 'call',
      conversationId: input.conversationId,
      callId: input.callId,
    },
    link: chatLink(input.linkToken),
  });
}
