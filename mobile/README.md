# VOXO Mobile

Android-only React Native (Expo) client. See the repo root `ARCHITECTURE.md` for the full system design and `DATABASE.md` for the backend schema this app talks to.

## Status

Through Phase 11: project setup, auth, chat (Socket.IO, media, reactions,
templates), contacts, dashboard, wallet/subscription/notifications, team
(RBAC) management, calling (real WhatsApp handoff via wa.me — see
`ARCHITECTURE.md` §6), and the native Android build/signing setup — see
`BUILD.md` for producing an actual APK.

## Requirements

- Node.js 20+
- An Expo **Development Build** on a device or emulator — **not Expo Go**.
  Expo Go can't load the native modules this app depends on
  (`react-native-mmkv`, `expo-secure-store`, Reanimated/worklets, etc.).

## Setup

```bash
cd mobile
npm install
cp .env.example .env   # then point EXPO_PUBLIC_API_URL / EXPO_PUBLIC_SOCKET_URL
                        # at your running backend (see ../backend/README-equivalent
                        # docs / ../backend/.env.example)
```

`10.0.2.2` in the example env file is the Android emulator's alias for your
host machine's `localhost` — change it to your backend's real address for a
physical device or a non-local backend.

## Running

```bash
npm run android   # starts Metro and opens on a connected device/emulator
                   # running a dev client (see below)
npm start          # Metro only, for an already-installed dev client
```

The **first time**, you need a dev client installed on the device. The
native `android/` project is already committed (see `BUILD.md`), so:

```bash
npx expo run:android
```

If you've changed `app.config.ts` since `android/` was last generated,
regenerate it first: `npx expo prebuild --platform android --clean`.

## Checks

```bash
npm run typecheck   # tsc --noEmit
npm run lint         # eslint .
npx expo export --platform android   # full Metro/Hermes bundle — the
                                       # closest thing to "does this actually
                                       # build" without a device/emulator
```

## Regenerating placeholder icons

`assets/icon.png`, `android-icon-*.png`, and `splash-icon.png` are
programmatically generated placeholders (solid brand color + a simple ring
mark — deliberately not WhatsApp's icon). Replace them with real design
assets before a production release; until then, `scripts/generate-placeholder-icons.js`
regenerates them deterministically:

```bash
npm run generate-placeholder-icons
```
