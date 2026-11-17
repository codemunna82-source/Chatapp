# VOXO — restored to the end of 10 Oct 2026 (read this first)

17 Nov 2026: the owner asked for everything after 9 Oct to be removed (rolled
back to `e80806d`), then asked for the 10 Oct work back. The tree is now the
exact state of commit `2697c78` (10 Oct, 22:11 UTC): WhatsApp/Meta flow with
the 10 Oct rate-limit work (global per-number send pacing, randomized
automatic-invitation delay, retry-instead-of-drop, fbtrace/backoff, the BullMQ
job-id fix), plus the 10 Oct app UI work.

- NOT in this tree (commit `72dbcfd` still holds it): everything from 11 Oct on
  — SMS capture/store/send, merged SMS+private row, permanent links, personal
  link, META_ON_HOLD and the admin WhatsApp/private-chat switch, Permissions
  screen. To bring them back, `git checkout 72dbcfd -- <paths>` or revert the
  rollback commits.
- Kept on purpose (build plumbing, not features): the APK workflow (all ABIs),
  the debug keystore + v1/v2/v3 signing and versionCode in
  `mobile/android/app/build.gradle` (same signer as earlier builds), and the
  4 GB Gradle heap in `mobile/android/gradle.properties` (the all-ABI package
  step ran out of memory at 2 GB). Bump versionCode in `mobile/app.config.ts`
  and `build.gradle` together on every build; Android refuses a downgrade.

## Working notes
- The owner writes in Hinglish; reply in Hinglish, short.
- No phone or emulator is available in the cloud session: say plainly what was not tested on a device.
- Server: Render service `Chatapp` (id `srv-da848quk1f9s73c8hhf0`, workspace `tea-d6rri324d50c73bb8lng`), auto-deploys from this branch. It needs MongoDB Atlas `cluster0.yygutuf.mongodb.net` reachable: Atlas Network Access must contain `0.0.0.0/0` or every deploy fails.
- APK: GitHub Actions workflow `android-build.yml`; output
  `https://github.com/codemunna82-source/Chatapp/releases/download/latest-apk/voxo.apk`.
  A local build needs `mobile/.env` with `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_SOCKET_URL` = `https://chatapp-0orj.onrender.com`.
- Customer web pages: repo `codemunna82-source/chat-app`, `frontend/`, branch `claude/project-analysis-j456rr`.
