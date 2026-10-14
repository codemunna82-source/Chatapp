# VOXO — read this first (owner's business flow, do not change without asking)

Full BRD (living doc): https://claude.ai/code/artifact/252b1d11-fb93-4d46-8b7c-34def13aa0b0
SMS design and tests: `mobile/SMS_LOCAL_SYNC.md`

## The flow (SMS-first, no WhatsApp)

1. A customer sends a **normal SMS** to the agent's phone number.
2. VOXO shows **every incoming SMS** in the Chats list (no keyword/sender filter), stored **only on the phone** (SQLite). SMS text is never uploaded; the server only ever receives the customer's phone number, to mint a link.
3. The agent **replies from VOXO**. The reply is the **invitation template + that customer's private chat link**, sent as a normal SMS from the agent's SIM (thread header link button and the "Send private chat invite" button; endpoint `POST /api/sms/invite-link`).
4. The customer taps the link and lands in the **private chat on VOXO's own server** (web, `waprivate.dev/c/<token>`). No Meta / WhatsApp involved.
5. From then on messages, images, voice and calls go through the private chat; the agent sees it in the same Chats list. **A customer with both an SMS chat and a private chat is ONE row** (matched on the last 10 digits of the number); opening it shows the private chat with that customer's SMS inside it, read-only, in time order.

## Rules the owner has fixed

- **No SMS inbox in Settings.** SMS chats live in Chats only. Settings > Permissions lists every permission with live status.
- **Links never expire** and are never revoked (`GUEST_SESSION_TTL_DAYS=0`; deleting a chat/contact does not break the link; no "new link"/revoke option in the app).
- **WhatsApp/Meta is on hold**: Render env `META_ON_HOLD=true` (replies go to the private chat, media is not uploaded to Meta, templates refused). Nothing is disconnected; `false` resumes it.
- **SMS permissions to list in the app**: incoming = Receive SMS, Read SMS, Notifications, Battery Unrestricted, Autostart; outgoing = Send SMS (+ Phone state on two-SIM phones). Plus "Allow restricted settings" on Android 13+ for sideloaded APKs.
- Do not adopt `react-native-android-sms-listener`: its receiver only runs while the app is on screen.

## Where things are

- Repo `codemunna82-source/chatapp`, branch `claude/guest-web-chat`: `mobile/` (React Native, native SMS code in `mobile/android/app/src/main/java/com/voxo/app/`) and `backend/`.
- Customer web pages: repo `codemunna82-source/chat-app`, `frontend/`, branch `claude/project-analysis-j456rr` (live at waprivate.dev; deploy branch not confirmed).
- Server: Render service `Chatapp` (id `srv-da848quk1f9s73c8hhf0`, workspace `tea-d6rri324d50c73bb8lng`), auto-deploys from the branch above.
- APK: GitHub Actions workflow `android-build.yml` on the branch; output `https://github.com/codemunna82-source/Chatapp/releases/download/latest-apk/voxo.apk` (includes Firebase push; local builds do not). Bump `ANDROID_VERSION_CODE` in `mobile/app.config.ts` and `versionCode` in `mobile/android/app/build.gradle` together.
- A local APK build needs `mobile/.env` with `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_SOCKET_URL` = `https://chatapp-0orj.onrender.com`, or the app closes on open.

## Working notes

- The owner writes in Hinglish; reply in Hinglish, short.
- No phone or emulator is available in the cloud session: say plainly what was not tested on a device.
- Native tests: `cd mobile/android && ./gradlew :app:testReleaseUnitTest --tests com.voxo.app.SmsStoreTest`. Backend tests that need MongoDB cannot run in the cloud sandbox.
