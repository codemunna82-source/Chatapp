import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ExpoConfig, ConfigContext } from 'expo/config';

// Android-only (spec §3) — no ios block is defined here on purpose, and no
// iOS-specific config should be added. versionCode is the single source of
// truth for the Play/APK build number; bump it on every release build
// (spec §46 reports it alongside the APK). This had been left at 1 across
// every build so far — bumping it here since an unchanged versionCode on a
// same-package/same-signature reinstall can make Android's installer treat
// a new APK as a no-op if the previous copy isn't uninstalled first.
const ANDROID_VERSION_CODE = 33;

// Resolved from this file's own directory rather than the working
// directory, so the config behaves the same whether Expo is invoked from
// mobile/ or from the repo root.
const GOOGLE_SERVICES_PATH = path.join(__dirname, 'google-services.json');

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'VOXO',
  slug: 'voxo',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'voxo', // deep links: voxo://conversation/{conversationId} (spec §31)
  userInterfaceStyle: 'automatic',
  android: {
    package: 'com.voxo.app',
    versionCode: ANDROID_VERSION_CODE,
    adaptiveIcon: {
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
      backgroundColor: '#26344D', // matches the new VOXO logo's navy backdrop
    },
    // Minimal permission set for what the app actually implements. Camera/
    // gallery access (Phase 7 media attachments) is granted by
    // expo-image-picker's own manifest merge + the runtime permission
    // prompts it makes at call time — it needs no entry here.
    // RECORD_AUDIO + MODIFY_AUDIO_SETTINGS back the composer's voice
    // recorder (expo-audio) — background recording/playback are explicitly
    // off below, so no foreground-service permissions are pulled in.
    // POST_NOTIFICATIONS is required from Android 13 (API 33) for FCM push;
    // below that, notification access is granted at install and the runtime
    // request is a no-op. Never request a permission the app doesn't use.
    permissions: [
      'INTERNET',
      'ACCESS_NETWORK_STATE',
      'RECORD_AUDIO',
      'MODIFY_AUDIO_SETTINGS',
      'POST_NOTIFICATIONS',
      // Raises the incoming-call UI over the lock screen — the one thing a
      // ringing notification must do that an ordinary one must not. Used
      // by the call notification alone; messages stay ordinary.
      'USE_FULL_SCREEN_INTENT',
      // Sharing a pin in a chat. COARSE only: a customer being told where
      // the shop is does not need the agent's position to the metre, and
      // the fine permission is a far larger thing to ask for on a screen
      // that is only sending a map link.
      'ACCESS_COARSE_LOCATION',
    ],
    /**
     * Firebase config for FCM. Not committed — it identifies one specific
     * Firebase project, so each deployment supplies its own by placing the
     * file downloaded from the Firebase console at mobile/google-services.json
     * (see PUSH_SETUP.md).
     *
     * Left undefined when the file is absent so the app still builds and
     * runs without Firebase: push simply never registers, and messages
     * arrive live over Socket.IO exactly as they did before push existed.
     */
    googleServicesFile: existsSync(GOOGLE_SERVICES_PATH) ? GOOGLE_SERVICES_PATH : undefined,
  },
  plugins: [
    'expo-secure-store',
    [
      // The wording Android shows when the app first asks. Without a
      // plugin entry expo-location writes its own generic sentence, which
      // reads as an app helping itself to a location for no stated reason.
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission: 'VOXO uses your location only when you choose to send it in a chat.',
        locationWhenInUsePermission: 'VOXO uses your location only when you choose to send it in a chat.',
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        resizeMode: 'contain',
        backgroundColor: '#26344D', // matches the new VOXO logo's navy backdrop
      },
    ],
    [
      // Phase 7 added this dependency but never registered its config
      // plugin — fixed in Phase 11 while regenerating the native project.
      //
      // This was `microphonePermission: false`, reasoning that the picker
      // itself only ever captures still photos. That reasoning was right
      // about the picker and wrong about the manifest: `false` does not
      // merely decline to ADD the permission, it emits
      // tools:node="remove" for RECORD_AUDIO, which strips the permission
      // expo-audio needs for the composer's voice messages — silently
      // breaking recording in any build regenerated from this config.
      // The app genuinely uses the microphone, so it declares it.
      'expo-image-picker',
      { microphonePermission: 'Allow VOXO to access your microphone to record voice messages.' },
    ],
    [
      // Push notifications. The icon is the existing monochrome adaptive
      // icon: Android renders a notification's small icon as a silhouette,
      // so a full-colour one comes out as a white blob.
      'expo-notifications',
      {
        icon: './assets/android-icon-monochrome.png',
        color: '#26344D',
        // Copied into res/raw, where the incoming-call channels name them.
        // Also committed under android/app/src/main/res/raw/, because this
        // build runs Gradle directly with no prebuild step — the plugin's
        // copy never happens here, and a channel naming a sound the APK
        // does not contain rings with the default chime instead.
        sounds: [
          './assets/ringtones/ringtone_classic.wav',
          './assets/ringtones/ringtone_chime.wav',
          './assets/ringtones/ringtone_pulse.wav',
          './assets/ringtones/ringtone_marimba.wav',
          './assets/ringtones/ringtone_bells.wav',
          './assets/ringtones/ringtone_digital.wav',
          './assets/ringtones/ringtone_soft.wav',
          './assets/ringtones/ringtone_urgent.wav',
        ],
      },
    ],
    [
      // Composer voice messages (Phase 12). Background playback/recording
      // are switched off on purpose: the app never plays/records past the
      // conversation screen being open, so there's no need for the
      // foreground-service + notification-control permissions/services
      // this plugin would otherwise add.
      'expo-audio',
      {
        microphonePermission: 'Allow VOXO to access your microphone to record voice messages.',
        enableBackgroundPlayback: false,
        enableBackgroundRecording: false,
      },
    ],
    [
      // Inline video playback in chat bubbles. Background playback and
      // picture-in-picture are both off: a video only ever plays inside an
      // open conversation, and enabling either would add a foreground
      // service and its notification for a case the app does not have.
      'expo-video',
      { supportsBackgroundPlayback: false, supportsPictureInPicture: false },
    ],
    [
      // Saving a contact into the phone's own address book (READ_CONTACTS
      // and WRITE_CONTACTS on Android) so a number added in VOXO can be
      // called and recognised outside it.
      'expo-contacts',
      { contactsPermission: 'Allow VOXO to save contacts you add to your phone’s address book.' },
    ],
  ],
  extra: {
    eas: {
      // Filled in when this project is linked to an EAS project for
      // release builds (Phase 11) — intentionally empty until then.
    },
  },
});
