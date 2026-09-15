import notifee, {
  AndroidImportance,
  AndroidStyle,
  AndroidVisibility,
  type Notification,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import { contactAvatarFile } from '../media/avatarCache';
import { useAuthStore } from '../store/authStore';
import { forgetThread, rememberMessage } from './messageThread';
import { chatDarkColors } from '../theme/chatTheme';

/**
 * The message notification, drawn by the app rather than by Android.
 *
 * Which is the whole reason this file exists. A notification Android
 * builds from an FCM `notification` block is one line of text and a
 * launcher icon: no sender photo, no thread when three messages arrive,
 * no Reply without opening the app. The tray owns it and none of this
 * app's code runs. Sending messages data-only is what moved that work
 * here, at the cost named on PushPayload.dataOnly on the server — Android
 * does not deliver a data-only message to an app that has been
 * force-stopped.
 */

/** Action ids, never button text. Labels are for people and may be
 *  translated; these are what the handler switches on. */
export const MESSAGE_REPLY_ACTION = 'VOXO_MESSAGE_REPLY';
export const MESSAGE_READ_ACTION = 'VOXO_MESSAGE_READ';

/** Must already exist on the device — pushRegistration creates it. Also
 *  what the server names in the payload, which is read in preference to
 *  this so a server that moves the channel does not need an app release. */
export const DEFAULT_CHAT_CHANNEL = 'voxo-messages';

/**
 * The same notification, with no sound of its own.
 *
 * A second channel exists because on Android 8 and later the SOUND
 * belongs to the channel and nothing on an individual notification can
 * override it — so "show this one silently" is only expressible as
 * "show this one on a silent channel".
 *
 * Used whenever something else is already making the noise: a message
 * arriving while the app is open, where the in-app chime has played, and
 * the redraw that confirms a reply the agent just typed. Without it both
 * would sound twice, which is the tell of two notification systems that
 * have not been introduced to each other.
 *
 * Still HIGH importance, so it is still a heads-up banner. Silent is not
 * the same as unimportant.
 */
export const QUIET_CHAT_CHANNEL = 'voxo-messages-quiet';

/**
 * One notification per conversation, and the id is what makes that true.
 *
 * Two messages from the same customer replace each other rather than
 * stacking into two entries — the thread inside the one notification is
 * where they stack. It is also how Mark as read and opening the chat
 * find the right notification to take away.
 */
export function messageNotificationId(conversationId: string): string {
  return `voxo-chat-${conversationId}`;
}

/** Notifications from different customers are grouped under one summary
 *  rather than filling the shade, the way every messaging app does it. */
const GROUP_ID = 'voxo-messages-group';

export interface IncomingMessageNotification {
  conversationId: string;
  contactName: string;
  /** The one-line preview the server built — "📷 Photo", the text, the
   *  reaction sentence. Already trimmed to a sensible length there. */
  preview: string;
  /** Whose photo to show. Absent for a contact who has never uploaded one. */
  contactId?: string;
  avatarVersion?: string;
  /** When the server sent it. A push that took ten minutes to arrive
   *  should say ten minutes ago, not now. */
  sentAt?: number;
  /** The channel the server named; falls back to this app's own. */
  channelId?: string;
  /**
   * This line is the workspace's own — a reply typed into the
   * notification. Redraws the same notification with the reply added
   * underneath, which is what tells the agent it actually went.
   */
  mine?: boolean;
  /** Draw it without a sound — see QUIET_CHAT_CHANNEL. */
  quiet?: boolean;
}

/**
 * Puts a message on screen, or adds it to the one already there.
 *
 * Safe to call more than once for the same message only in the sense that
 * Android will not stack duplicates — the thread WILL gain a line, so the
 * caller is responsible for not handing the same message over twice. The
 * collapse key on the server is what makes that hold in practice.
 */
export async function displayMessageNotification(
  input: IncomingMessageNotification,
): Promise<void> {
  if (Platform.OS !== 'android') return;

  const at = input.sentAt && input.sentAt > 0 ? input.sentAt : Date.now();
  const thread = rememberMessage(input.conversationId, {
    text: input.preview,
    at,
    ...(input.mine ? { mine: true as const } : {}),
  });

  // Best-effort and never blocking the notification on it: a face is a
  // nicety, a message arriving is not.
  const icon = await contactAvatarFile(
    input.contactId,
    input.avatarVersion,
    useAuthStore.getState().accessToken,
  );

  const person = {
    name: input.contactName,
    // Android draws a circle here. Without an icon it draws the sender's
    // initial, which is a better fallback than this app could build.
    ...(icon ? { icon } : {}),
  };

  const notification: Notification = {
    id: messageNotificationId(input.conversationId),
    title: input.contactName,
    body: input.preview,
    data: {
      type: 'message',
      conversationId: input.conversationId,
      ...(input.contactId ? { contactId: input.contactId } : {}),
    },
    android: {
      // The quiet channel wins over whatever the server named: the server
      // knows what kind of message this is, but only the app knows
      // whether something has already made a noise about it.
      channelId: input.quiet ? QUIET_CHAT_CHANNEL : (input.channelId ?? DEFAULT_CHAT_CHANNEL),
      // The brand navy, matching the small icon the manifest already
      // tints — NOT the call green, which is what tells a ringing call
      // apart from a message at a glance.
      color: chatDarkColors.primary,
      smallIcon: 'notification_icon',
      /**
       * A real thread rather than one line.
       *
       * Every message this conversation has sent since the notification
       * went up, each with its own time — which is what makes "three
       * messages while I was in a meeting" readable without opening
       * anything. `person` on each line is what puts the face beside it.
       */
      style: {
        type: AndroidStyle.MESSAGING,
        person,
        messages: thread.map((entry) => ({
          text: entry.text,
          timestamp: entry.at,
          // Omitted for our own replies, which is precisely how
          // MessagingStyle is told a line is from the reader — see
          // ThreadEntry.mine.
          ...(entry.mine ? {} : { person }),
        })),
      },
      // Grouped so five customers are five lines under one summary
      // instead of five separate notifications pushing everything else
      // out of the shade.
      groupId: GROUP_ID,
      importance: AndroidImportance.HIGH,
      // Content hidden on a locked screen. The opposite of the call
      // notification, deliberately: a call is useless if you cannot see
      // who it is from before unlocking, and a customer's message is the
      // kind of thing that should not be readable over someone's
      // shoulder.
      visibility: AndroidVisibility.PRIVATE,
      pressAction: { id: 'default', launchActivity: 'default' },
      // Dismissed by a swipe like any message notification. A message is
      // not a call: nothing is waiting on an answer.
      autoCancel: true,
      timestamp: at,
      showTimestamp: true,
      actions: [
        {
          title: 'Reply',
          pressAction: { id: MESSAGE_REPLY_ACTION },
          /**
           * Direct reply, typed in the shade.
           *
           * The single biggest thing an agent gets from this being drawn
           * by the app: answering a customer without opening anything.
           * `allowFreeFormInput` is what makes it a text field rather
           * than a list of canned replies.
           */
          input: {
            allowFreeFormInput: true,
            placeholder: `Reply to ${input.contactName}`,
          },
        },
        { title: 'Mark as read', pressAction: { id: MESSAGE_READ_ACTION } },
      ],
    },
  };

  await notifee.displayNotification(notification);
  // The summary is always quiet. It carries no content of its own, and a
  // group header that chimes alongside the message it is summarising is
  // the same sound twice.
  await ensureSummary(QUIET_CHAT_CHANNEL);
}

/**
 * The row Android shows above a group.
 *
 * Required: a groupId with no summary renders as loose notifications on
 * some versions and as an empty group header on others. It carries no
 * content of its own — the children are the content — which is why it has
 * no actions and no thread.
 */
async function ensureSummary(channelId: string): Promise<void> {
  await notifee.displayNotification({
    id: GROUP_ID,
    title: 'VOXO',
    body: 'New messages',
    android: {
      channelId,
      groupId: GROUP_ID,
      groupSummary: true,
      smallIcon: 'notification_icon',
      color: chatDarkColors.primary,
      autoCancel: true,
      pressAction: { id: 'default', launchActivity: 'default' },
    },
  });
}

/**
 * Takes a conversation's notification away, and the thread with it.
 *
 * Called when the chat is opened, when Mark as read is pressed, and when
 * the notification is dismissed. The thread has to go too: left behind,
 * it would reappear underneath tomorrow's first message as if none of it
 * had been read.
 */
export async function clearMessageNotification(conversationId: string): Promise<void> {
  forgetThread(conversationId);
  if (Platform.OS !== 'android') return;
  try {
    await notifee.cancelNotification(messageNotificationId(conversationId));
  } catch {
    // Already gone, which is the outcome this wanted anyway.
  }
  // The summary does not remove itself when its last child goes, and a
  // group header alone in the shade saying "New messages" is worse than
  // no notification at all.
  try {
    const remaining = await notifee.getDisplayedNotifications();
    const children = remaining.filter(
      (n) => n.notification.android?.groupId === GROUP_ID && n.id !== GROUP_ID,
    );
    if (children.length === 0) await notifee.cancelNotification(GROUP_ID);
  } catch {
    // Not fatal: a stale summary is tidied by the next message anyway.
  }
}
