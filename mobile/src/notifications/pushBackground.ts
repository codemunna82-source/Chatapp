import notifee, { EventType } from '@notifee/react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { displayIncomingCall, cancelIncomingCall } from '../calling/callNotification';
import { handleCallAction } from '../calling/callActions';
import { displayMessageNotification } from './messageNotification';
import { handleMessageAction } from './messageActions';
import { forgetThread } from './messageThread';
import { shouldShowPush } from './signedOutGuard';

/**
 * Everything a push needs while the app is NOT running.
 *
 * Imported from the entry file, before React, because both registrations
 * have to exist the moment Android hands this process a message — by the
 * time a component could mount, the work is already over.
 *
 * Two separate mechanisms, because they answer different questions:
 *
 *   expo-notifications' task  →  "a data message arrived"  →  draw it
 *   notifee's background event → "a button was pressed"    →  act on it
 *
 * Neither can do the other's job. The task cannot show a notification
 * with actions, and notifee never sees FCM messages.
 *
 * One router for calls AND messages, because there is one FCM data
 * stream: every data-only push this app receives arrives here, whatever
 * it is about. Messages joined calls in being drawn by the app so that
 * they could carry a face, a thread and a Reply box — see
 * messageNotification.ts.
 */

// Named for calls because that is what it first carried, and renaming it
// would be a new registration for no gain.
const CALL_MESSAGE_TASK = 'VOXO_CALL_MESSAGE';

/** The shape the server sends, for every kind of data push. Everything is
 *  a string: FCM rejects any data value that is not one, and does not
 *  coerce. See push.service.ts for what each type carries. */
interface PushData {
  type?: string;
  channelId?: string;
  // Calls
  callId?: string;
  callerName?: string;
  callType?: string;
  ringingSince?: string;
  // Messages and reactions
  conversationId?: string;
  contactId?: string;
  contactName?: string;
  preview?: string;
  avatarVersion?: string;
  sentAt?: string;
}

type CallData = PushData;

/** A ring that was already over when it arrived — the phone was out of
 *  signal, or Doze held the message. Showing it would ring at a call
 *  nobody is waiting on. FCM's own 45s TTL is the first line of this;
 *  the clock is the second, for a message delivered just inside it. */
const RING_STALE_AFTER_MS = 60_000;

/** The server's ring clock, or undefined when it did not send one (an
 *  older backend). Never a guess: the chronometer counting from the wrong
 *  moment is worse than it counting from now. */
function ringingSince(data: CallData): number | undefined {
  const since = Number(data.ringingSince);
  return Number.isFinite(since) && since > 0 ? since : undefined;
}

function isStale(data: CallData): boolean {
  const since = ringingSince(data);
  return since !== undefined && Date.now() - since > RING_STALE_AFTER_MS;
}

async function onPushData(data: PushData): Promise<void> {
  /**
   * Nothing is drawn for an install nobody is signed into.
   *
   * Checked here rather than per type, because it applies to all of
   * them: a call, a message and a cancellation are equally not this
   * phone's business once its session has ended. See signedOutGuard for
   * the case that makes this necessary — a refresh token that expired
   * leaves no credential to detach the device with.
   */
  if (!(await shouldShowPush())) return;

  if (data.type === 'message' || data.type === 'reaction') {
    if (!data.conversationId) return;
    const sentAt = Number(data.sentAt);
    await displayMessageNotification({
      conversationId: data.conversationId,
      contactName: data.contactName?.trim() || 'New message',
      preview: data.preview?.trim() || 'New message',
      contactId: data.contactId,
      avatarVersion: data.avatarVersion,
      sentAt: Number.isFinite(sentAt) && sentAt > 0 ? sentAt : undefined,
      channelId: data.channelId,
    });
    return;
  }

  if (!data.callId) return;

  if (data.type === 'call_cancelled') {
    await cancelIncomingCall(data.callId);
    return;
  }

  if (data.type !== 'incoming_call' || isStale(data)) return;

  await displayIncomingCall({
    callId: data.callId,
    callerName: data.callerName,
    callType: data.callType === 'video' ? 'video' : 'audio',
    channelId: data.channelId,
    ringingSince: ringingSince(data),
  });
}

TaskManager.defineTask<{ data?: Record<string, unknown> }>(
  CALL_MESSAGE_TASK,
  async ({ data, error }) => {
    if (error || !data) return;
    // Android nests the FCM data payload one level down; some versions
    // hand it over flat. Reading both is cheaper than depending on which.
    const payload = ((data as { data?: PushData }).data ?? data) as PushData;
    try {
      await onPushData(payload);
    } catch {
      // A thrown background task is a crash with no user in front of it.
      // The call is still recoverable through PendingCallSync.
    }
  },
);

/**
 * Presses arriving while the app is in the background or not running.
 *
 * Registered at module load, which is the contract: notifee requires this
 * to be set before the runtime finishes starting, or a press that woke the
 * process finds nothing listening.
 */
notifee.onBackgroundEvent(async ({ type, detail }) => {
  // DISMISSED as well as ACTION_PRESS: a message notification swiped away
  // has to take its remembered thread with it, or tomorrow's first
  // message reappears underneath everything that was already dealt with.
  if (type === EventType.DISMISSED) {
    const conversationId = detail.notification?.data?.conversationId as string | undefined;
    if (conversationId) forgetThread(conversationId);
    return;
  }
  if (type !== EventType.ACTION_PRESS) return;

  const actionId = detail.pressAction?.id;
  if (!actionId) return;
  const data = (detail.notification?.data ?? {}) as Record<string, string | undefined>;

  try {
    if (data.conversationId) {
      // `detail.input` is what the agent typed into the Reply box. It is
      // on the event, not on the action, which is why it travels
      // separately into the handler.
      const handled = await handleMessageAction(
        actionId,
        {
          conversationId: data.conversationId,
          contactName: data.contactName,
          contactId: data.contactId,
          avatarVersion: data.avatarVersion,
          channelId: data.channelId,
        },
        detail.input,
      );
      if (handled) return;
    }
    if (data.callId) await handleCallAction(actionId, data.callId);
  } catch {
    // Same reasoning as above — there is no screen to report to.
  }
});

/**
 * Asks expo-notifications to run the task for incoming data messages.
 *
 * Awaited by nobody: it is idempotent, it costs one native call, and a
 * failure here leaves the socket and PendingCallSync doing what they
 * already did before any of this existed.
 */
export function registerPushBackgroundTask(): void {
  void Notifications.registerTaskAsync(CALL_MESSAGE_TASK).catch(() => {
    // Not supported on this platform, or already registered.
  });
}
