import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
  type Notification,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import { DEFAULT_RINGTONE_ID, ringtoneById } from './ringtones';
import { useRingtoneStore } from '../store/ringtoneStore';

/**
 * The incoming-call notification — the one with Accept and Reject on it.
 *
 * Drawn by the APP rather than by Android, which is the whole reason this
 * file exists. A notification Android draws from an FCM `notification`
 * block cannot carry buttons: the system tray owns it and none of this
 * app's code runs. So calls are pushed data-only and built here.
 *
 * notifee rather than expo-notifications because expo-notifications can
 * neither attach actions to a remote notification nor raise a full-screen
 * intent, and both are what makes this feel like a call instead of an
 * alert. Everything else in the app — message alerts, channels, the
 * permission prompt — stays on expo-notifications; this is the one
 * notification that needed more.
 */

/** Action ids, never button text. Labels are for people and may be
 *  translated; these are what the handler switches on. */
export const CALL_ACCEPT_ACTION = 'VOXO_CALL_ACCEPT';
export const CALL_REJECT_ACTION = 'VOXO_CALL_REJECT';

/**
 * The notification id IS the call id.
 *
 * Which makes every display idempotent for free: FCM retries, a duplicate
 * push and a socket event arriving alongside all address the same
 * notification, and Android replaces rather than stacks. It is also what
 * lets a cancellation arriving from anywhere find the right one.
 */
export function callNotificationId(callId: string): string {
  return `voxo-call-${callId}`;
}

export interface IncomingCallNotification {
  callId: string;
  callerName: string;
  callType: 'audio' | 'video';
  /** The ringtone channel this device chose — see ringtones.ts. Falls back
   *  to the default when a push predates the picker. */
  channelId?: string;
}

/**
 * Puts a ringing call on screen.
 *
 * Safe to call more than once for the same call: same id, so Android
 * replaces rather than stacks.
 */
export async function displayIncomingCall(call: IncomingCallNotification): Promise<void> {
  if (Platform.OS !== 'android') return;

  // The channel the push named, or this device's own choice if it did not
  // — never a hard-coded id, or a ringtone picked in Settings would be
  // ignored by the one notification it was picked for.
  const channelId =
    call.channelId ?? ringtoneById(useRingtoneStore.getState().ringtoneId ?? DEFAULT_RINGTONE_ID).channelId;

  const notification: Notification = {
    id: callNotificationId(call.callId),
    title: call.callerName || 'Incoming call',
    body: call.callType === 'video' ? 'Incoming video call' : 'Incoming audio call',
    data: { type: 'incoming_call', callId: call.callId, callType: call.callType },
    android: {
      channelId,
      // CALL is what tells Android this is a phone call: it ranks above
      // other notifications, survives some Do Not Disturb modes, and is
      // what a car or watch uses to decide how to present it.
      category: AndroidCategory.CALL,
      importance: AndroidImportance.HIGH,
      // Shown in full on a locked screen. A call the user cannot identify
      // without unlocking is a call they will not answer.
      visibility: AndroidVisibility.PUBLIC,
      // Cannot be swiped away. A ring that can be dismissed by accident is
      // a missed customer, and it is removed deliberately — on answer,
      // reject, cancel or timeout.
      ongoing: true,
      autoCancel: false,
      // Raises the call UI over the lock screen where Android allows it.
      // Falls back to a heads-up banner where it does not, which is the
      // behaviour on a device that has not granted the permission.
      fullScreenAction: { id: 'default', launchActivity: 'default' },
      pressAction: { id: 'default', launchActivity: 'default' },
      // Reject first, Accept second — the same order as the phone app, so
      // muscle memory does not hang up on a customer.
      actions: [
        { title: 'Reject', pressAction: { id: CALL_REJECT_ACTION } },
        { title: 'Accept', pressAction: { id: CALL_ACCEPT_ACTION, launchActivity: 'default' } },
      ],
      // The sound and vibration belong to the channel, not here: Android
      // fixes both when a channel is created, which is why each ringtone
      // owns one.
      timestamp: Date.now(),
      showTimestamp: true,
    },
  };

  await notifee.displayNotification(notification);
}

/** Takes the ring back — answered elsewhere, rejected, cancelled or timed
 *  out. Harmless when there is nothing showing. */
export async function cancelIncomingCall(callId: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await notifee.cancelNotification(callNotificationId(callId));
  } catch {
    // Already gone, which is the outcome this wanted anyway.
  }
}
