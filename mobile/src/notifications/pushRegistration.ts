import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { registerDevice, unregisterDevice } from '../api/endpoints/devices';

/** Must match CHAT_CHANNEL_ID in the backend's push.service.ts. A payload
 *  naming a channel that does not exist is silently dropped by Android. */
export const CHAT_CHANNEL_ID = 'voxo-messages';

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

/** What the last registration attempt concluded; null before the first. */
export function getPushStatus(): PushStatus | null {
  return lastStatus;
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
  try {
    const devicePushToken = await Notifications.getDevicePushTokenAsync();
    // The native FCM token is a string on Android; the type is a union
    // covering web push, where it is not.
    token = typeof devicePushToken.data === 'string' ? devicePushToken.data : null;
  } catch {
    // The build has no google-services.json, so there is no Firebase
    // project to get a token from. Separated from the registration call
    // below because the two need completely different things done about
    // them, and telling them apart was impossible before.
    token = null;
  }
  if (!token) {
    lastStatus = 'no-firebase-config';
    return lastStatus;
  }

  try {
    await registerDevice(token, Platform.OS === 'ios' ? 'ios' : 'android');
  } catch {
    lastStatus = 'server-rejected';
    return lastStatus;
  }

  currentToken = token;
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
