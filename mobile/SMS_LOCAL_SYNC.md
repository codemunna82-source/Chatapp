# On-device SMS sync (Android)

Incoming SMS are captured natively, stored in a local SQLite database on the
phone, and shown in VOXO's Chats list and chat screen. **SMS content never
leaves the device** — nothing in this path calls the VOXO backend. (The older
`/api/sms/sync` upload from the app has been removed; see "What changed".)

## Architecture

```
SMS arrives ──► SmsStoreReceiver (manifest, BROADCAST_SMS-guarded)
                 │  parses PDUs (multipart joined), sender, original SC timestamp, SIM
                 ▼
            VoxoSmsDatabase (SQLite voxo_sms.db, WAL)   ◄── VOXO's own sends (recordOutgoing)
                 │  dedup: exact key + near-duplicate window      ◄── history import (content://sms)
                 │  on SQLite failure: parked in SharedPreferences, flushed on next open
                 ▼
            VoxoSmsEvents ──(JS alive & subscribed)──► "VoxoSmsReceived" event
                 │
            VoxoSmsStoreModule  ◄── src/native/smsStore.ts (typed bridge)
                                      │
                                      ├─ src/queries/useLocalSms.ts  (React Query, Conversation/Message mapping)
                                      ├─ src/utils/LocalSmsRunner.tsx (events, resume reload, incremental import)
                                      ├─ ChatsListScreen  (SMS threads merged as normal ChatListItem rows)
                                      └─ SmsThreadScreen  (same bubbles/wallpaper/header/composer)
```

### Storage

`voxo_sms.db`, table `sms_messages`: `dedup_key` (unique), `thread_key`,
`address`, `body`, `timestamp` (original send time), `received_at`,
`direction` (IN/OUT), `status`, `subscription_id`, `sim_slot`, `source`
(broadcast/import/voxo), `provider_id`, `read`, `delivered_to_js`.
`deleted_threads` holds tombstones so a thread deleted in VOXO is not
re-imported.

- **Thread key**: last 10 digits of a numeric sender (so `+91 98765 43210`,
  `09876543210`, `9876543210` are one thread); alphanumeric senders
  upper-cased without punctuation (`VM-HDFCBK` → `VMHDFCBK`).
- **Dedup key**: SHA-256 of `direction | thread | timestamp-in-seconds | body`.
  A re-delivered broadcast or a re-import of the same provider row is
  dropped by the unique index.
- **Near-duplicate rule**: same thread, direction and body within 2 minutes
  (on either clock) is treated as the same message. This catches an import of
  a message the receiver already saved on OEMs whose provider stores only the
  receive time. Trade-off: the identical text sent twice by the same person
  within 2 minutes is kept once.

## Files

New (native) — `android/app/src/main/java/com/voxo/app/`
- `VoxoSmsDatabase.kt` — SQLite store, dedup, threads/messages queries, tombstones, fallback queue.
- `SmsStoreReceiver.kt` — `SMS_RECEIVED` receiver; multipart assembly, timestamp, SIM slot; `goAsync` + background thread.
- `VoxoSmsStoreModule.kt` — `VoxoSmsStore` native module (methods below) and the `VoxoSmsReceived` event.
- `VoxoSmsDiagnostics.kt` — persistent capture diagnostics + the in-process event bus.

Changed (native)
- `AndroidManifest.xml` — registers `.SmsStoreReceiver` (exported, `android:permission="android.permission.BROADCAST_SMS"`). `RECEIVE_SMS`/`READ_SMS`/`SEND_SMS` were already declared.
- `VoxoSmsAutoReplyPackage.kt` — also registers `VoxoSmsStoreModule`.
- `VoxoSmsAutoReplyModule.kt`, `SmsAutoReplySendReceiver.kt` — every SMS VOXO sends (composer, invitations, auto-reply) is also written to the local store.
- `app/build.gradle` — test-only dependencies and Robolectric repo URL; `versionCode` 52.

New (JS) — `src/`
- `native/smsStore.ts` — typed bridge: `getSmsPermissionStatus`, `requestSmsPermissions`, `getSmsThreads`, `getSmsMessages`, `markSmsThreadRead`, `deleteSmsThread`, `getUndeliveredSms`, `markSmsDelivered`, `importSmsHistory`, `getSmsStoreDiagnostics`, `subscribeToNewSms`.
- `queries/useLocalSms.ts` — React Query hooks and mapping to the existing `Conversation`/`Message` types.
- `utils/LocalSmsRunner.tsx` — mounted for signed-in users in `RootNavigator`.

Changed (JS)
- `screens/chats/ChatsListScreen.tsx` — SMS threads merged into the list (same row component); search and Unread/Read filters apply; long-press offers Mark as read / Delete from VOXO; SMS rows are excluded from server bulk actions and the archive.
- `screens/chats/SmsThreadScreen.tsx` — the SMS thread, built from MessageBubble, DateSeparator, ChatWallpaper, ChatHeaderTitle and Composer.
- `screens/chats/Composer.tsx` — `localOnly` prop: no typing events to the server for an SMS thread.
- `screens/chats/ConversationDetailScreen.tsx` — a legacy server-side SMS-only conversation now opens the local SMS thread instead; no SMS is recorded on the server.
- `screens/settings/SmsInboxScreen.tsx` — "SMS sync status" card (permissions, battery optimisation, stored count, receiver last ran, last error).
- `screens/settings/PermissionsScreen.tsx` — accurate SMS permission descriptions; granting starts a sync immediately.

Removed
- `utils/smsSync.ts`, `utils/SmsSyncRunner.tsx`, `api/endpoints/sms.ts`, `useSendSmsMessage` — the code that uploaded SMS to the backend.

### Dependencies

No new runtime dependency. Test-only (`testImplementation`, not in the APK):
`junit:junit:4.13.2`, `org.robolectric:robolectric:4.14.1`, `androidx.test:core:1.6.1`.

## Permissions and settings VOXO needs (all listed in Settings > Permissions)

| For | Item | Why |
|---|---|---|
| Incoming | Receive SMS (`RECEIVE_SMS`) | The OS delivers each new SMS to `SmsStoreReceiver` |
| Incoming | Read SMS (`READ_SMS`) | Imports history, and recovers messages the receiver missed |
| Incoming | Notifications (`POST_NOTIFICATIONS`) | Alert for a new SMS |
| Incoming | Battery: Unrestricted | Otherwise the phone may stop VOXO before it handles the SMS |
| Incoming | Autostart / background activity (Realme, Xiaomi, Vivo, Oppo) | Lets VOXO start for an SMS while closed. Android cannot report it, so the screen says "Check" |
| Outgoing | Send SMS (`SEND_SMS`) | Sends from the phone's SIM |
| Outgoing, two SIMs | Phone state (`READ_PHONE_STATE`) | If the phone asks "which SIM?" for every SMS, VOXO picks the first active SIM instead of failing |
| Setup | "Allow restricted settings" (App info > ⋮) | Android 13+ blocks SMS permissions for an APK installed outside a store until this is allowed |

Settings > Permissions shows each one with a live status and "X of Y allowed"; Settings > SMS shows when the receiver last ran, SMS stored, and the last error.

## Outgoing: how a send is tracked

`sendTracked` stores the text as **SENDING**, hands it to the radio with a sent-intent per part, and `SmsSentReceiver` settles it: **SENT** when the network accepted it, **FAILED** (with the reason in Settings > SMS: no signal, airplane mode, refused, ...) otherwise. A failed bubble has a retry that removes the failed copy and sends again. Before this, every send showed as sent the moment it was pressed.

## Not adopted: react-native-android-sms-listener

Reviewed and deliberately not added. It registers its receiver on the Activity and unregisters it in `onHostPause`, so it only hears SMS while the app is on screen; it stores nothing, sends nothing, and handles multipart by concatenating parts. VOXO's manifest receiver + SQLite store already cover all of that, and also work with the app closed.

## Behaviour

| Situation | What happens |
|---|---|
| VOXO open | Receiver stores the SMS and emits `VoxoSmsReceived`; the list and open thread refresh immediately. |
| VOXO in background / closed (not force-stopped) | Android starts the process for the broadcast; the receiver stores it. On next open/resume, `getUndelivered` reloads it. |
| App restart | The store is a file; everything is still there. |
| Offline | Nothing here uses the network. |
| Duplicate broadcast | Dropped by the dedup key. |
| Multipart SMS | Android reassembles the parts into one broadcast; they are joined in order. |
| Dual SIM | Subscription id read from the intent extras (`android.telephony.extra.SUBSCRIPTION_INDEX`, `subscription`, …); slot from `SubscriptionManager.getSlotIndex` (API 29+) or OEM extras. `-1` when the device does not say. |
| Database error | The message is parked in SharedPreferences and flushed into SQLite on the next successful open; the error is shown in Settings > SMS. |
| Permission denied | Nothing is captured or imported; the list shows only server chats. Asked once automatically; afterwards from Settings > Permissions. |

## Device-specific limitations (read before testing)

- **Force-stop**: if the user force-stops VOXO (App info > Force stop), Android
  delivers **no** broadcasts to it until it is opened again. SMS received in that
  time are not captured live; they are recovered by the history import on the
  next open (needs `READ_SMS`).
- **Restricted settings (Android 13+)**: for an APK installed outside an app
  store, Android may block the SMS permission dialog ("Restricted setting").
  The user must open App info > ⋮ > **Allow restricted settings**, then grant
  SMS. Some installers/OEMs do not allow it at all; then no SMS can be captured or imported.
- **OEM battery managers** (Realme/ColorOS, Xiaomi/MIUI, Vivo, Oppo, Samsung):
  may block background starts. Set VOXO's battery usage to "Unrestricted"/"No
  restrictions" and allow auto-start. Settings > SMS shows whether battery
  optimisation is on.
- **Not the default SMS app**: VOXO reads and receives SMS but is not the
  phone's default SMS app, so it cannot mark SMS read in the phone's Messages
  app, and texts VOXO sends may not appear in the phone's own Messages app on
  some OEMs (they always appear in VOXO).
- **RCS / chat features**: messages sent over RCS (Google Messages "chat")
  are not SMS and are never delivered to `SMS_RECEIVED` nor stored in
  `content://sms`. They will not appear in VOXO.
- **iOS**: Apple provides no API to read SMS. Nothing here runs on iOS.

## Verification done

- `tsc --noEmit` and ESLint on all changed files: clean.
- Release build (`assembleRelease`, arm64-v8a + armeabi-v7a): successful; manifest contains the receiver; bundle contains the new code and no `/sms/sync` call.
- JVM tests (Robolectric, `SmsStoreTest`, 12 tests) covering: multipart PDU assembly with original timestamp and sender, far-future timestamp fallback, subscription id, thread-key normalisation, duplicate broadcast, import-after-broadcast near-duplicate, same text on different days kept, thread list/unread/read, pagination, delete + tombstone, pending/ack, fallback queue flush. They caught and fixed a real bug (text-bound SQL parameters made the near-duplicate check match everything).
- **Not done here**: running on a real device or emulator. This build machine has no hardware virtualisation and no phone. The on-device checklist below is still required.

### On-device test checklist

1. Install the APK, open VOXO, sign in, allow SMS when asked (or Settings > Permissions).
2. Chats: existing SMS threads appear (history import). Settings > SMS shows "SMS stored on this phone" > 0.
3. With VOXO open on Chats, send a text to the phone from another phone → it appears at the top within a second; open it → unread clears.
4. Send a long (> 160 chars) text → one bubble, full text.
5. Swipe VOXO away (do NOT force-stop), receive an SMS, open VOXO → it is there; "Receiver last ran" updated.
6. Force-stop VOXO, receive an SMS, open VOXO → it appears after the import (receiver did not run: "Receiver last ran" unchanged).
7. Dual SIM: receive on SIM 2 → stored (thread shows it).
8. Reply from the SMS thread → bubble appears; nothing goes to WhatsApp.
9. Airplane mode + Wi‑Fi off: open threads → still readable.

## Build the APK

From `mobile/` (Node 20, JDK 17, Android SDK platform 36 + build-tools 36.0.0):

```sh
npm ci
# The JS bundle needs the backend URL at build time (src/utils/env.ts throws without it):
printf 'EXPO_PUBLIC_API_URL=https://chatapp-0orj.onrender.com\nEXPO_PUBLIC_SOCKET_URL=https://chatapp-0orj.onrender.com\n' > .env
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
# → app/build/outputs/apk/release/app-release.apk (signed with the debug keystore, JS bundle embedded)
./gradlew :app:testReleaseUnitTest --tests com.voxo.app.SmsStoreTest
```

`assembleDebug` produces an APK that loads JS from a Metro dev server
(`npx expo start`) instead of an embedded bundle — use it only with a laptop
connected. The release-type APK above is the one to install and test on a phone.
