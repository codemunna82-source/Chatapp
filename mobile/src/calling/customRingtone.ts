import notifee, { AndroidImportance, AndroidVisibility } from '@notifee/react-native';
import { Platform } from 'react-native';
import { CUSTOM_RINGTONE_ID, ringtoneById } from './ringtones';

/**
 * "Use a sound from this phone."
 *
 * Android does not let an app point a notification channel at an
 * arbitrary file. A channel's sound is resolved out of `res/raw` inside
 * the APK, or the system default — a `content://` from the phone's own
 * music is not accepted, which is why this cannot be a ninth bundled
 * ringtone with a file picker in front of it.
 *
 * What Android does allow is its own channel settings screen, where the
 * owner of the phone chooses any sound on it. So this creates a channel
 * for the purpose and sends them there. The sound they pick is then read
 * back off the channel — the one channel property Android reports once
 * the user has had it — so the in-app ringer plays exactly what the
 * notification will.
 *
 * The result is a feature with no native code and no file copying, whose
 * picker is the one the phone's owner already knows.
 */

const CUSTOM_CHANNEL_ID = ringtoneById(CUSTOM_RINGTONE_ID).channelId;

/**
 * Creates the channel, if this phone does not have it.
 *
 * Created through notifee rather than expo-notifications, unlike the
 * eight bundled tones: only notifee's channel API understands
 * `sound: 'default'`, and starting from the phone's own default ringtone
 * is what makes this channel useful the moment it exists — before anyone
 * has been to settings, it already rings.
 *
 * A channel's sound cannot be changed by the app after creation, which is
 * exactly the point here: from now on it belongs to the user.
 */
export async function ensureCustomChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await notifee.createChannel({
    id: CUSTOM_CHANNEL_ID,
    name: 'Incoming calls (your own sound)',
    description: 'Rings when a customer calls you. Tap Sound to choose any file on this phone.',
    // HIGH, where the bundled channels ask expo-notifications for MAX.
    // notifee's scale stops at HIGH, and it is the level that actually
    // decides the behaviour that matters here — heads-up, sound, and
    // passing the readiness check in callReadiness.ts. MAX above it is
    // Android's own deprecated step and changes nothing.
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    // The phone's own ringtone until its owner picks something else, so
    // this channel is never silent — a "custom ringtone" that rings with
    // nothing until you visit a settings screen is a broken feature, not
    // an unconfigured one.
    sound: 'default',
    vibration: true,
    // The phone-like cadence the bundled tones use: long, gap, long, so
    // it reads as ringing rather than as a message even in a pocket.
    vibrationPattern: [0, 800, 600, 800, 600, 800],
    lightColor: '#26344D',
  });
}

/**
 * Opens Android's settings for that channel, where Sound is a row.
 *
 * Deliberately the system screen and not a file picker of this app's own.
 * A picker would give a file this app can play and Android cannot ring
 * with — the two would disagree, and the one that matters (the call
 * arriving on a locked phone) would be the one that was wrong.
 */
export async function openCustomSoundPicker(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await ensureCustomChannel();
  await notifee.openNotificationSettings(CUSTOM_CHANNEL_ID);
}

/**
 * What the phone will actually ring with, as a URI, or null.
 *
 * Read back rather than remembered: the user can change it in system
 * settings at any time without this app being involved, so anything
 * stored here would go stale the first time they did.
 *
 * Null covers every case with the same answer — the channel does not
 * exist yet, they have not chosen anything, or the platform is not
 * Android — because the caller does the same thing in all of them.
 */
export async function customSoundUri(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const channel = await notifee.getChannel(CUSTOM_CHANNEL_ID);
    return channel?.soundURI ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether the user has moved this channel off the phone's default.
 *
 * Used only to word the row — "Default ringtone" against "Your own
 * sound". Android reports the default as a `settings/` URI under the
 * media provider, which is the only shape this needs to recognise; a
 * wrong guess costs a word, not the ringtone.
 */
export function isDefaultSound(uri: string | null): boolean {
  return !uri || uri.includes('/settings/');
}
