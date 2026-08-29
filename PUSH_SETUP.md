# Push notifications (Firebase Cloud Messaging)

Everything in the app is already wired. What is missing is one Firebase
project, which only you can create — it is tied to your Google account and
your app's package name. Two files come out of it: one for the Android
build, one for the backend.

Until both are in place the app behaves exactly as it did before push
existed: messages arrive live over Socket.IO while VOXO is open, and
nothing arrives while it is closed. Nothing errors, nothing is broken —
push simply never registers.

## What you get once it works

| Event | Notification |
| --- | --- |
| Customer sends a message | Contact's name + a preview (media types get a label, e.g. "📷 Photo") |
| Customer reacts to your message | "Reacted 👍 to your message: …" — worded differently on purpose, see below |
| Teammate starts a WhatsApp call handoff | "Asha is calling Priya on WhatsApp", to everyone except the teammate who started it |

Tapping any of these opens the relevant conversation.

**There is no incoming-call notification, and this is not an oversight.**
The webhook this backend receives from Meta carries `messages` and
`statuses` only. Calls in VOXO are `wa.me` handoffs into the real WhatsApp
app, where the call happens outside anything this backend can observe.
Meta does publish a separate WhatsApp Business Calling API with its own
`calls` webhook field; it is not wired here, it has to be enabled on the
WhatsApp Business Account, and inventing a handler for a payload shape
nobody has verified would be worse than not having one.

## Step 1 — Create the Firebase project

1. <https://console.firebase.google.com> → **Add project**. Name it
   anything (e.g. `voxo`). Google Analytics is not needed.
2. In the project, click the **Android** icon to add an app.
3. **Android package name** must be exactly:

   ```
   com.voxo.app
   ```

   This has to match `android.package` in `mobile/app.config.ts`. A
   mismatch does not error — FCM just silently refuses every token.
4. Download **`google-services.json`**.

## Step 2 — Put `google-services.json` in the app

Place it at:

```
mobile/google-services.json
```

That one path is enough. `app.config.ts` picks it up when it exists (and
stays valid when it does not), and `android/app/build.gradle` copies it to
where the Gradle plugin reads it. You do not need to place a second copy
under `android/`.

The Firebase Gradle plugin is applied only when the file is present. That
conditional matters: the plugin fails the build outright when the JSON is
missing, so applying it unconditionally would make Firebase mandatory for
anyone who just wants to build the app.

**It is gitignored on purpose** — it identifies your specific Firebase
project. For the GitHub Actions APK build, add its contents as a repository
secret named `GOOGLE_SERVICES_JSON` (Settings → Secrets and variables →
Actions), and the workflow writes it to disk before building.

## Step 3 — Service account key for the backend

1. Firebase console → ⚙️ **Project settings** → **Service accounts**.
2. **Generate new private key** → downloads a JSON file.
3. Open it and copy the **entire contents** (it starts with `{` and
   contains `"type": "service_account"`).
4. Render → your backend service → **Environment** → add:

   | Key | Value |
   | --- | --- |
   | `FCM_SERVICE_ACCOUNT_JSON` | the whole JSON, pasted as one value |

Paste it as-is. The backend handles the `\n` escaping that hosting
dashboards introduce into the private key — that mangled newline is the
single most common reason a correctly-configured FCM setup fails with an
opaque crypto error.

Save and wait for the redeploy. The quickest confirmation is the
deployment self-check, which reports whether the backend actually parsed
the service account:

```
https://<your-service>.onrender.com/api/webhooks/meta/health
```

`"pushConfigured": true` means it can send. `false` means the variable is
unset or malformed — and the deploy log says which.

The log is still where the reason lives. If the JSON is malformed
you will see it named explicitly rather than having to guess:

```
FCM_SERVICE_ACCOUNT_JSON is not valid JSON — push notifications are disabled
```

and if it is simply absent:

```
FCM_SERVICE_ACCOUNT_JSON not set — push notifications are disabled; the app
still receives messages live over Socket.IO while it is open
```

## Step 4 — Build and test

1. Build a new APK (`google-services.json` must be present at build time —
   it is compiled into the app, not read at runtime).
2. Install, sign in. Android 13+ shows a notification permission prompt.
3. Close VOXO completely (swipe it away).
4. Message the WhatsApp number from another phone.
5. The notification should arrive within a few seconds.

## If nothing arrives

Work down this list — it is roughly in order of how often each one is the
cause.

- **`FCM_SERVICE_ACCOUNT_JSON` not set on Render.** Check the deploy log
  for the warning above.
- **The APK was built without `google-services.json`.** The file is
  compiled in; adding it afterwards does nothing for an already-built APK.
- **Notification permission declined.** Android settings → Apps → VOXO →
  Notifications. A declined permission cannot be re-requested by the app;
  it has to be turned on there.
- **Package name mismatch.** Firebase must say `com.voxo.app` exactly.
- **Battery optimisation.** Some Android skins (Xiaomi, Oppo, Vivo,
  Samsung) aggressively kill background apps and their FCM connections.
  Settings → Apps → VOXO → Battery → Unrestricted.
- **The device was never registered.** Registration is silent by design —
  it is not an error worth interrupting anyone about — so check the
  `devicetokens` collection in MongoDB for a row, rather than expecting an
  on-screen message.

## What is deliberately not done

- **No notification while you are looking at that chat.** The message is
  already on screen; a banner over it is noise. Same rule as the in-app
  chime.
- **No sound from the push while the app is open.** The in-app alert
  (Settings → New message alerts) already handles that and respects your
  toggles. Two systems making a noise for one message is a bug.
- **Dead tokens are pruned automatically** when FCM reports a token as
  `UNREGISTERED` or `INVALID_ARGUMENT`, so uninstalled apps do not
  accumulate forever.
- **Signing out unregisters the device**, so a shared phone stops receiving
  the previous user's workspace notifications.
