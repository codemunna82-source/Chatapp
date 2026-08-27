import type { ExpoConfig, ConfigContext } from 'expo/config';

// Android-only (spec §3) — no ios block is defined here on purpose, and no
// iOS-specific config should be added. versionCode is the single source of
// truth for the Play/APK build number; bump it on every release build
// (spec §46 reports it alongside the APK).
const ANDROID_VERSION_CODE = 1;

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
    // prompts it makes at call time — it needs no entry here. Push
    // notifications (and the exact-alarm/foreground-service permissions
    // that would come with them) were never built — Phase 8's Notifications
    // screen is an in-app REST inbox, not FCM — so still nothing to add for
    // that. RECORD_AUDIO + MODIFY_AUDIO_SETTINGS were added for the
    // composer's real voice-message recorder (expo-audio) — background
    // recording/playback are explicitly off below, so no foreground-service
    // permissions are pulled in. Never request a permission the app
    // doesn't actually use.
    permissions: ['INTERNET', 'ACCESS_NETWORK_STATE', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS'],
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
      // microphonePermission: false because the app only ever captures
      // still photos (AttachmentSheet's launchCameraAsync), never records
      // video with audio through the picker itself — voice messages are
      // recorded separately via expo-audio below.
      'expo-image-picker',
      { microphonePermission: false },
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
