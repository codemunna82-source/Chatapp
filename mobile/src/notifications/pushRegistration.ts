import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { registerDevice, unregisterDevice } from '../api/endpoints/devices';
import { RINGTONES, channelConfigFor, type Ringtone } from '../calling/ringtones';
import { currentRingtone } from '../store/ringtoneStore';

/** Must match CHAT_CHANNEL_ID in the backend's push.service.ts. A payload
 *  naming a channel that does not exist is silently dropped by Android. */
export const CHAT_CHANNEL_ID = 'voxo-messages';

/**
 * Ringing calls live on a channel of their own — see calling/ringtones.ts,
 * which owns the ids because each ringtone owns a channel.
 *
 * Not for tidiness: an Android channel's sound and importance are FIXED at
 * creation and only the user can change them afterwards. A call and a
 * message sharing one channel can never sound different, however the
 * payload is written.
 */
/**
 * Makes this phone's chosen ringtone the one Android rings with.
 *
 * Creates the channel for the selected ringtone and deletes the channels
 * belonging to the others, so system settings lists ONE "Incoming calls"
 * entry rather than eight.
 *
 * Deleting is safe here only because each ringtone owns a DIFFERENT
 * channel id. Android remembers a deleted channel's settings and restores
 * them if a channel with the same id is created again — so the obvious
 * implementation, one channel re-created with a new sound, silently keeps
 * the old sound forever. Different ids side-step that entirely.
 */
export async function applyRingtoneChannel(ringtone: Ringtone): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ringtone.channelId, channelConfigFor(ringtone));
  await Promise.all(
    RINGTONES.filter((r) => r.channelId !== ringtone.channelId).map((r) =>
      Notifications.deleteNotificationChannelAsync(r.channelId).catch(() => {
        // Never created on this device, which is the normal case.
      }),
    ),
  );
}

let currentToken: string | null = null;

/**
 * Android 8+ requires every notification to name a channel that already
 * exists, and the channel's importance — not the payload's priority — is
 * what decides whether it makes a sound or shows a heads-up banner. It also
 * cannot be changed after creation: once a channel exists on a device, only
 * the user can alter it in system settings.
 */
async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHAT_CHANNEL_ID, {
    name: 'Messages',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#26344D',
  });

  await applyRingtoneChannel(currentRingtone());
}

/**
 * Asks for permission (Android 13+ requires it at runtime; below that it is
 * granted at install) and registers this install's FCM token with the
 * backend.
 *
 * Returns false rather than throwing on every failure path — no Firebase
 * config in the build, a declined permission, a simulator with no Play
 * Services. None of those are errors the user should be interrupted about:
 * the app still receives everything live over the socket while it is open,
 * which is exactly how it behaved before push existed.
 */
/**
 * Why push is not working, in the user's words.
 *
 * This used to return a bare false from six different places, and say
 * nothing to anybody — not a log, not a screen, nothing. So "push does
 * not arrive" had no visible difference between a refused permission, a
 * build with no Firebase config, and a server that never heard of this
 * device. It stayed invisible for as long as it did for exactly that
 * reason. Every path now names itself.
 */
export type PushStatus =
  | 'registered'
  | 'permission-denied'
  | 'no-firebase-config'
  | 'server-rejected'
  | 'emulator';

export const PUSH_STATUS_TEXT: Record<PushStatus, string> = {
  registered: 'On — alerts arrive when VOXO is closed',
  'permission-denied':
    'Blocked. Turn notifications on for VOXO in your phone settings, then tap to retry.',
  'no-firebase-config':
    'This build has no push configuration, so this phone cannot be registered for alerts.',
  'server-rejected': 'Could not register this phone with the server. Tap to retry.',
  emulator: 'Not available on an emulator.',
};

let lastStatus: PushStatus | null = null;
let lastDetail: string | null = null;

/** What the last registration attempt concluded; null before the first. */
export function getPushStatus(): PushStatus | null {
  return lastStatus;
}

/**
 * What actually went wrong, in the platform's own words.
 *
 * The five statuses above say WHICH step failed. They do not say why,
 * and for `no-firebase-config` that gap has now cost three rounds of
 * guessing: the config file is demonstrably in the APK, the Gradle
 * plugin demonstrably ran, R8 has keep rules for every Firebase class —
 * and getDevicePushTokenAsync still throws. The message it throws with
 * is the one piece of evidence nobody has looked at, because the catch
 * discarded it.
 *
 * Several completely different faults land on this same status and need
 * completely different fixes:
 *
 *   "Default FirebaseApp is not initialized"  → the config never loaded
 *   "SERVICE_NOT_AVAILABLE"                   → FCM was unreachable; retrying works
 *   "MISSING_INSTANCEID_SERVICE"              → no Play Services on this ROM
 *   "AUTHENTICATION_FAILED"                   → wrong Firebase project
 *
 * Only the first is a build problem. Telling them apart is the whole
 * point of keeping this string.
 */
export function getPushDetail(): string | null {
  return lastDetail;
}

export async function registerForPushNotifications(): Promise<PushStatus> {
  // An emulator has no FCM token to give, and asking produces a confusing
  // error rather than a useful one.
  if (!Device.isDevice) {
    lastStatus = 'emulator';
    return lastStatus;
  }

  await ensureChannel();

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted && existing.canAskAgain) {
    const requested = await Notifications.requestPermissionsAsync();
    granted = requested.granted;
  }
  if (!granted) {
    lastStatus = 'permission-denied';
    return lastStatus;
  }

  let token: string | null = null;
  lastDetail = null;
  try {
    const devicePushToken = await Notifications.getDevicePushTokenAsync();
    // The native FCM token is a string on Android; the type is a union
    // covering web push, where it is not.
    token = typeof devicePushToken.data === 'string' ? devicePushToken.data : null;
    if (!token) lastDetail = 'The platform returned a token that was not a string.';
  } catch (err) {
    // Kept, not discarded. This branch covers a missing config, an
    // uninitialised Firebase, an unreachable FCM and a ROM with no Play
    // Services — four different problems with four different fixes, and
    // the message is the only thing that separates them. See
    // getPushDetail above for what the common ones look like.
    lastDetail = err instanceof Error ? err.message : String(err);
    token = null;
  }
  if (!token) {
    lastStatus = 'no-firebase-config';
    return lastStatus;
  }

  try {
    await registerDevice(
      token,
      Platform.OS === 'ios' ? 'ios' : 'android',
      // Sent on every registration, so changing the ringtone and letting
      // the app re-register is all it takes for calls to arrive on the new
      // channel — there is no separate "update my ringtone" call to get
      // out of step with this one.
      Platform.OS === 'android' ? currentRingtone().channelId : undefined,
    );
  } catch (err) {
    lastDetail = err instanceof Error ? err.message : String(err);
    lastStatus = 'server-rejected';
    return lastStatus;
  }

  currentToken = token;
  lastDetail = null;
  lastStatus = 'registered';
  return lastStatus;
}

/** Detaches this device from the workspace on sign-out. Best-effort: if the
 *  call fails the user is signing out regardless, and blocking that on a
 *  network round trip would be worse than a stale token the backend prunes
 *  when its next send bounces. */
export async function unregisterForPushNotifications(): Promise<void> {
  if (!currentToken) return;
  const token = currentToken;
  currentToken = null;
  try {
    await unregisterDevice(token);
  } catch {
    // Intentionally ignored — see above.
  }
}
