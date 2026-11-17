# VOXO — rolled back to the 9 Oct 2026 state (read this first)

On 17 Nov 2026 the owner asked for everything after 9 Oct to be taken out, so
WhatsApp/Meta works as it did before the SMS-first changes. The tree was
restored to commit `e80806d`; the work it removed is NOT lost:

- The full pre-rollback state is commit `72dbcfd` on this branch
  (`claude/guest-web-chat`). To get it back, revert the rollback commit
  (`git revert <rollback commit>`), or `git checkout 72dbcfd -- .`.
- What was removed: SMS capture/store/send (native), merged SMS+private row,
  permanent private-chat links, personal "chat with me" link, META_ON_HOLD and
  the admin WhatsApp/private-chat switch, the 10 Oct pacing/jitter for
  WhatsApp sends, customer web-push changes, Permissions screen, v51-v59 APK work.
- Kept on purpose (build plumbing, not features): the APK workflow (all ABIs),
  the debug keystore + v1/v2/v3 signing in `mobile/android/app/build.gradle`
  (same signer as v59, so the new APK installs over it), and versionCode 60
  (must stay above 59; Android refuses a downgrade).

## Working notes
- The owner writes in Hinglish; reply in Hinglish, short.
- No phone or emulator is available in the cloud session: say plainly what was not tested on a device.
- Server: Render service `Chatapp` (id `srv-da848quk1f9s73c8hhf0`), auto-deploys from this branch.
- APK: GitHub Actions workflow `android-build.yml`; output
  `https://github.com/codemunna82-source/Chatapp/releases/download/latest-apk/voxo.apk`.
  A local build needs `mobile/.env` with `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_SOCKET_URL` = `https://chatapp-0orj.onrender.com`.
- Customer web pages: repo `codemunna82-source/chat-app`, `frontend/`, branch `claude/project-analysis-j456rr`.
