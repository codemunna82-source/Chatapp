import notifee, { EventType } from '@notifee/react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { displayIncomingCall, cancelIncomingCall } from './callNotification';
import { handleCallAction } from './callActions';

/**
 * Everything a ringing call needs while the app is NOT running.
 *
 * Imported from the entry file, before React, because both registrations
 * have to exist the moment Android hands this process a message — by the
 * time a component could mount, the work is already over.
 *
 * Two separate mechanisms, because they answer different questions:
 *
 *   expo-notifications' task  →  "a data message arrived"  →  draw the call
 *   notifee's background event → "a button was pressed"    →  act on it
 *
 * Neither can do the other's job. The task cannot show a notification
 * with actions, and notifee never sees FCM messages.
 */

const CALL_MESSAGE_TASK = 'VOXO_CALL_MESSAGE';

/** The shape the server sends. Everything is a string: FCM rejects any
 *  data value that is not one, and does not coerce. */
interface CallData {
  type?: string;
  callId?: string;
  callerName?: string;
  callType?: string;
  channelId?: string;
  ringingSince?: string;
}

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

async function onCallData(data: CallData): Promise<void> {
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
    const payload = ((data as { data?: CallData }).data ?? data) as CallData;
    try {
      await onCallData(payload);
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
  if (type !== EventType.ACTION_PRESS) return;
  const actionId = detail.pressAction?.id;
  const callId = (detail.notification?.data?.callId as string | undefined) ?? '';
  if (!actionId || !callId) return;
  try {
    await handleCallAction(actionId, callId);
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
export function registerCallBackgroundTask(): void {
  void Notifications.registerTaskAsync(CALL_MESSAGE_TASK).catch(() => {
    // Not supported on this platform, or already registered.
  });
}
