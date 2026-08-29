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
const ANDROID_VERSION_CODE = 3;

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
  ],
  extra: {
    eas: {
      // Filled in when this project is linked to an EAS project for
      // release builds (Phase 11) — intentionally empty until then.
    },
  },
});
