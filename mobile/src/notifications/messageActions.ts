import { useAuthStore } from '../store/authStore';
import * as messagesApi from '../api/endpoints/messages';
import * as conversationsApi from '../api/endpoints/conversations';
import {
  clearMessageNotification,
  displayMessageNotification,
  MESSAGE_READ_ACTION,
  MESSAGE_REPLY_ACTION,
} from './messageNotification';

/**
 * Reply and Mark as read, from the notification itself.
 *
 * One function for all three worlds the press can arrive in — app in
 * front, app in the background, app not running — for the same reason
 * callActions.ts is: the decision is identical in each and only the
 * machinery around it differs. Three copies would be three places for
 * this to drift.
 */

/**
 * The background handler runs with a fresh module graph and nothing has
 * loaded the session yet, so the API client would send no token at all.
 * The same guard callActions.ts uses, and for the same reason.
 */
async function ensureAuth(): Promise<boolean> {
  if (useAuthStore.getState().accessToken) return true;
  await useAuthStore.getState().hydrate();
  return Boolean(useAuthStore.getState().accessToken);
}

export interface MessageActionContext {
  conversationId: string;
  /** For redrawing the notification after a reply — it is rebuilt from
   *  scratch, so the name and face have to come back with it. */
  contactName?: string;
  contactId?: string;
  avatarVersion?: string;
  channelId?: string;
}

/**
 * Handles one press. Returns true if it was ours.
 *
 * The signature takes the typed text separately because notifee delivers
 * it on the event rather than on the action, and this function is called
 * from two different event shapes.
 */
export async function handleMessageAction(
  actionId: string | undefined,
  context: MessageActionContext,
  typed?: string,
): Promise<boolean> {
  if (!context.conversationId) return false;

  if (actionId === MESSAGE_READ_ACTION) {
    // The notification goes first, before the network. A button that
    // stays on screen while a request is in flight gets pressed again.
    await clearMessageNotification(context.conversationId);
    try {
      if (await ensureAuth()) {
        await conversationsApi.bulkUpdateConversations([context.conversationId], 'read');
      }
    } catch {
      // Offline, or the session has expired. The notification is gone
      // either way, which is what the agent asked for; the unread count
      // corrects itself the next time the app syncs.
    }
    return true;
  }

  if (actionId !== MESSAGE_REPLY_ACTION) return false;

  const text = typed?.trim();
  // An empty direct-reply box. Nothing to send, and nothing to apologise
  // for — leave the notification exactly as it was.
  if (!text) return true;

  try {
    if (!(await ensureAuth())) throw new Error('No session');
    await messagesApi.sendMessage(context.conversationId, { type: 'text', text });
  } catch {
    /**
     * The reply did not go, and this is the only place that can say so.
     *
     * Silence here is the worst outcome available: the agent typed an
     * answer, watched the notification accept it, and the customer never
     * heard from them. So the notification comes back with the failure
     * as its newest line — visible, and tappable straight into the chat
     * where the text can be typed again.
     *
     * Deliberately NOT queued into the offline outbox: that lives in the
     * app's React tree and this may be running in a headless process
     * that is about to be killed, so a queued message could sit
     * unsendable and unseen. Telling the truth now is better.
     */
    await displayMessageNotification({
      conversationId: context.conversationId,
      contactName: context.contactName ?? 'Message not sent',
      preview: `Couldn’t send: "${text}" — tap to open the chat`,
      contactId: context.contactId,
      avatarVersion: context.avatarVersion,
      channelId: context.channelId,
      mine: true,
      // The agent is looking at the phone they just typed into.
      quiet: true,
    });
    return true;
  }

  /**
   * Sent. The notification comes back with the reply underneath rather
   * than disappearing, which is what a phone does and what tells the
   * agent it actually went — a notification that simply vanishes is
   * indistinguishable from one that was dismissed by accident.
   */
  await displayMessageNotification({
    conversationId: context.conversationId,
    contactName: context.contactName ?? 'VOXO',
    preview: text,
    contactId: context.contactId,
    avatarVersion: context.avatarVersion,
    channelId: context.channelId,
    mine: true,
    // The agent is looking at the phone they just typed into.
    quiet: true,
  });

  // Answering is reading. Leaving the chat unread after a reply has gone
  // out would show a bold row in the list for a conversation the agent
  // has just dealt with.
  try {
    await conversationsApi.bulkUpdateConversations([context.conversationId], 'read');
  } catch {
    // Same as above: corrected on the next sync.
  }
  return true;
}
