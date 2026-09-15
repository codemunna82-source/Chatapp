import * as Notifications from 'expo-notifications';

/**
 * The ringtones VOXO ships, and the one place that knows about them.
 *
 * Every other file — the picker, the in-app ringer, the Android channel —
 * derives from this list, so adding a ninth is one entry here and one
 * file in assets/ringtones plus res/raw.
 *
 * They are SYNTHESISED (see scripts/gen_ringtones.py in the commit that
 * added them): an APK redistributes whatever it ships, and eight audio
 * files of unclear provenance is eight licensing questions to answer
 * later. Arithmetic has no licence.
 */
export interface Ringtone {
  id: string;
  label: string;
  /**
   * Bundled asset, for ringing while the app is open.
   *
   * Absent for the one entry that is not a file this app ships — see
   * CUSTOM_RINGTONE_ID, where the sound is whatever the phone's owner
   * chose and lives outside the APK entirely.
   */
  asset?: number;
  /**
   * The Android notification channel that carries this sound when the app
   * is CLOSED.
   *
   * One channel per ringtone, and not for tidiness: a channel's sound is
   * fixed the moment it is created and only the user can change it
   * afterwards. Picking a different ringtone therefore cannot mean
   * "change this channel" — it has to mean "use a different channel".
   *
   * `classic` keeps the plain `voxo-calls` id that shipped in build 31,
   * so a phone that already has that channel is not left with a second
   * one saying the same thing.
   */
  channelId: string;
  /**
   * res/raw filename the channel names. Must exist in the APK.
   *
   * Absent for the custom entry, whose channel is created asking for the
   * phone's DEFAULT ringtone and then handed to the owner to change —
   * see CUSTOM_RINGTONE_ID.
   */
  channelSound?: string;
}

/**
 * The entry that is not one of ours.
 *
 * Android will not let an app point a notification channel at an
 * arbitrary file: a channel's sound is resolved from `res/raw` inside the
 * APK (or the system default), and a `content://` from the phone's own
 * storage is not accepted — which is why the eight above are the eight
 * this app ships, and why "use my own MP3" cannot simply be a ninth file.
 *
 * What Android DOES allow is its own channel settings screen, where the
 * owner of the phone picks any sound on it, including one they added
 * themselves. So this entry creates a channel of its own and sends them
 * there. The chosen sound is then read back off the channel — it is the
 * one channel property Android reports — so the in-app ringer plays the
 * same thing the notification does.
 */
export const CUSTOM_RINGTONE_ID = 'custom';

export const RINGTONES: Ringtone[] = [
  {
    id: 'classic',
    label: 'Classic',
    asset: require('../../assets/ringtones/ringtone_classic.wav'),
    channelId: 'voxo-calls',
    channelSound: 'ringtone_classic.wav',
  },
  {
    id: 'chime',
    label: 'Chime',
    asset: require('../../assets/ringtones/ringtone_chime.wav'),
    channelId: 'voxo-calls-chime',
    channelSound: 'ringtone_chime.wav',
  },
  {
    id: 'pulse',
    label: 'Pulse',
    asset: require('../../assets/ringtones/ringtone_pulse.wav'),
    channelId: 'voxo-calls-pulse',
    channelSound: 'ringtone_pulse.wav',
  },
  {
    id: 'marimba',
    label: 'Marimba',
    asset: require('../../assets/ringtones/ringtone_marimba.wav'),
    channelId: 'voxo-calls-marimba',
    channelSound: 'ringtone_marimba.wav',
  },
  {
    id: 'bells',
    label: 'Bells',
    asset: require('../../assets/ringtones/ringtone_bells.wav'),
    channelId: 'voxo-calls-bells',
    channelSound: 'ringtone_bells.wav',
  },
  {
    id: 'digital',
    label: 'Digital',
    asset: require('../../assets/ringtones/ringtone_digital.wav'),
    channelId: 'voxo-calls-digital',
    channelSound: 'ringtone_digital.wav',
  },
  {
    id: 'soft',
    label: 'Soft',
    asset: require('../../assets/ringtones/ringtone_soft.wav'),
    channelId: 'voxo-calls-soft',
    channelSound: 'ringtone_soft.wav',
  },
  {
    id: 'urgent',
    label: 'Urgent',
    asset: require('../../assets/ringtones/ringtone_urgent.wav'),
    channelId: 'voxo-calls-urgent',
    channelSound: 'ringtone_urgent.wav',
  },
  {
    id: CUSTOM_RINGTONE_ID,
    label: 'A sound from this phone',
    // No asset and no channelSound: this one is not a file VOXO ships.
    channelId: 'voxo-calls-custom',
  },
];

export const DEFAULT_RINGTONE_ID = 'classic';

/** Falls back to the default rather than returning undefined: a stored id
 *  can outlive the ringtone it names, and a call with no sound at all is a
 *  worse answer than a call with the wrong one. */
export function ringtoneById(id: string | null | undefined): Ringtone {
  return RINGTONES.find((r) => r.id === id) ?? RINGTONES[0]!;
}

/** The channel settings for a ringtone, in one place so creation and
 *  re-creation can never describe it differently. */
export function channelConfigFor(ringtone: Ringtone): Notifications.NotificationChannelInput {
  return {
    name: 'Incoming calls',
    description: 'Rings when a customer calls you.',
    // MAX, not HIGH: a ringing call is the one notification worth
    // interrupting whatever is on screen, and HIGH does not do that.
    importance: Notifications.AndroidImportance.MAX,
    sound: ringtone.channelSound,
    // A phone-like cadence rather than the short triple-buzz a message
    // gets: long, gap, long, so it reads as ringing even in a pocket.
    vibrationPattern: [0, 800, 600, 800, 600, 800],
    enableVibrate: true,
    lightColor: '#26344D',
  };
}
