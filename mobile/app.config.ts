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
      backgroundColor: '#4C3FE0',
    },
    // Minimal permission set for what Phase 6 actually implements. Media
    // (camera/gallery/mic for attachments, Phase 7) and exact-alarm/
    // foreground-service permissions (notifications, Phase 8) are added
    // when those features land — never request a permission the app
    // doesn't yet use.
    permissions: ['INTERNET', 'ACCESS_NETWORK_STATE'],
  },
  plugins: [
    'expo-secure-store',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        resizeMode: 'contain',
        backgroundColor: '#4C3FE0',
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
