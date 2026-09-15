import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidStyle,
  AndroidVisibility,
  type Notification,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import { DEFAULT_RINGTONE_ID, ringtoneById } from './ringtones';
import { useRingtoneStore } from '../store/ringtoneStore';
import { chatDarkColors } from '../theme/chatTheme';

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
 * How long the notification stays before Android removes it itself.
 *
 * Matched to RINGING_TTL_MS on the server, which is what decides a call
 * has gone unanswered. They have to agree: shorter here and the phone
 * stops ringing at a call still waiting; longer and a notification
 * outlives the call it was for, which is the one thing a ring must never
 * do. A belt to the server's braces — the cancellation push is what
 * normally clears it, and this is what clears it when that push cannot
 * be delivered.
 */
const RING_TIMEOUT_MS = 60_000;

/**
 * The colour of the whole notification.
 *
 * The app's own success green (chatTheme) rather than the VOXO navy every
 * other notification uses, and deliberately: green is what Android's own
 * dialler and every phone app uses for a ringing call, and it is what
 * makes this one notification readable as a call rather than as another
 * message — which is the difference an agent is deciding in the second
 * before they answer. Taken from the theme rather than written out here
 * so the ring and the app agree on what green means.
 */
const CALL_COLOR = chatDarkColors.success;

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
  /** Optional so every caller can hand over whatever the server sent
   *  without inventing a placeholder of its own — the fallback below is
   *  the only one, and so the only one to keep in step. */
  callerName?: string;
  callType: 'audio' | 'video';
  /** The ringtone channel this device chose — see ringtones.ts. Falls back
   *  to the default when a push predates the picker. */
  channelId?: string;
  /** When it started ringing, for the chronometer. The server's clock, so
   *  a slow delivery does not make the call look newer than it is. */
  ringingSince?: number;
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

  const caller = call.callerName?.trim() || 'Unknown caller';
  const line = call.callType === 'video' ? 'Incoming video call' : 'Incoming audio call';

  const notification: Notification = {
    id: callNotificationId(call.callId),
    // The NAME is the headline, and the kind of call the subtitle — the
    // order every phone uses, because who is calling is what decides
    // whether to answer and the rest is detail.
    title: caller,
    body: line,
    data: { type: 'incoming_call', callId: call.callId, callType: call.callType },
    android: {
      channelId,
      // The monochrome mark the manifest already names as this app's
      // notification icon. notifee falls back to the launcher icon
      // otherwise, which Android renders as a white blob.
      smallIcon: 'notification_icon',
      // Fully coloured, the way Android dresses a phone call. Among a
      // column of grey notifications this is the one that reads as
      // urgent without anybody having to look twice.
      color: CALL_COLOR,
      colorized: true,
      // The app mark, round, where a phone puts the caller's photo. Not
      // the contact's own avatar: those are served from an authenticated
      // endpoint and the system's image loader has no token to present —
      // a broken image is worse than a consistent one.
      largeIcon: require('../../assets/icon.png'),
      circularLargeIcon: true,
      // Wakes the screen, like a call. The one notification in this app
      // that has earned it; a message must never do this.
      lightUpScreen: true,
      // Keeps ringing rather than chiming once and giving up on someone
      // who is in another room.
      loopSound: true,
      // A live count of how long it has been ringing — the only honest
      // motion a notification can have, and it answers the question
      // someone glancing at a missed-looking ring actually has.
      showChronometer: true,
      chronometerDirection: 'up',
      // Android removes it on its own if nothing else does. See
      // RING_TIMEOUT_MS.
      timeoutAfter: RING_TIMEOUT_MS,
      // Expanded, the name gets a full line instead of being cut to fit
      // beside the icon.
      style: { type: AndroidStyle.BIGTEXT, text: `${line}\n${caller}` },
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
        { title: 'Decline', pressAction: { id: CALL_REJECT_ACTION } },
        { title: 'Answer', pressAction: { id: CALL_ACCEPT_ACTION, launchActivity: 'default' } },
      ],
      // The sound and vibration belong to the channel, not here: Android
      // fixes both when a channel is created, which is why each ringtone
      // owns one.
      //
      // The timestamp is what the chronometer counts from, so it is the
      // moment the ring STARTED rather than the moment this was drawn —
      // a push that took three seconds to arrive should not reset the
      // clock and tell the agent a call is newer than it is.
      timestamp: call.ringingSince ?? Date.now(),
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
