# Sentry setup

Both the backend and the Android app are wired for Sentry but report
**nothing** until you give them a DSN. That is deliberate: no DSN means the
SDK never initialises, so a local checkout, the test suite and any build you
make without one send no data anywhere.

At the time this was written the Sentry org `v0x0` had **no projects**, so
there was no error data to work from. These are the steps that change that.

---

## 1. Create two projects

In <https://v0x0.sentry.io> → **Projects** → **Create Project**:

| Project | Platform to pick | Used by |
| --- | --- | --- |
| `voxo-backend` | Node.js → Express | `backend/` |
| `voxo-mobile` | React Native | `mobile/` |

Two projects, not one. They have different releases, different error
shapes and different alerting needs — a Mongo timeout and an Android render
crash have nothing to say to each other, and merging them makes both harder
to read.

Copy the DSN each project shows you.

---

## 2. Backend

On Render → your backend service → **Environment**:

```
SENTRY_DSN=https://…@…ingest.sentry.io/…
SENTRY_TRACES_SAMPLE_RATE=0.1
```

`SENTRY_RELEASE` is optional on Render — the code falls back to
`RENDER_GIT_COMMIT`, which Render sets for you, so every deploy is already
attributable to a commit. Set it explicitly anywhere else.

Redeploy. On boot nothing is logged if it worked; to prove it end to end,
hit a route that throws and look for the event.

### What the backend reports, and what it does not

- **Reported:** unhandled exceptions, anything with a 5xx status, failed
  BullMQ jobs (webhook processing and the subscription sweep), unhandled
  promise rejections.
- **Not reported:** every `ApiError` below 500. A closed 24-hour window, a
  contact that was deleted, an expired token — these are the API working
  correctly, and reporting them would bury the real failures. See
  `isReportableError` in `backend/src/lib/sentry.ts`.

---

## 3. Mobile

In `mobile/.env`:

```
EXPO_PUBLIC_SENTRY_DSN=https://…@…ingest.sentry.io/…
EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.1
```

`EXPO_PUBLIC_*` values are inlined into the JS bundle and ship inside the
APK. That is fine for a DSN — it only grants permission to **write**
events, never to read them. It is not fine for `SENTRY_AUTH_TOKEN`, which
does grant read access; that one belongs in CI only (see step 4).

Rebuild the APK. The DSN is baked in at build time, so changing `.env`
needs a new build.

### What the app reports

- Native and JS crashes, including anything the `ErrorBoundary` catches
  (which React otherwise swallows entirely).
- Message sends that failed against the server.
- Media uploads that failed.
- Messages the offline outbox gave up on — a message the user believed was
  sent and which was then permanently lost.
- The screen name each event happened on, via the React Navigation
  integration.

---

## 4. Source maps (do this before trusting a release stack trace)

Without source maps, a stack trace from a release APK points at minified
Hermes bytecode and is close to useless. Wiring this up needs an auth token
and a build step, so it is not enabled by default:

1. Sentry → **Settings → Auth Tokens** → create a token with
   `project:releases` and `org:read`.
2. Put it in your CI secrets as `SENTRY_AUTH_TOKEN`. **Never** in `.env`,
   never in an `EXPO_PUBLIC_` variable, never committed.
3. Add the Expo config plugin to `mobile/app.config.ts`:

   ```ts
   plugins: [
     // …existing plugins…
     ['@sentry/react-native/expo', { organization: 'v0x0', project: 'voxo-mobile' }],
   ],
   ```

4. Rebuild. The plugin uploads the bundle's source maps as part of the
   Gradle build.

Until step 4 is done, JS stack traces from release builds will be
minified. Backend traces are unaffected — Node runs the compiled output
with source maps already available.

---

## 5. Privacy — read this before raising any sampling rate

This is a WhatsApp inbox. The data flowing through it is customers' phone
numbers and the text of their messages. The configuration reflects that:

- `sendDefaultPii: false` on both sides. Turning it on attaches request
  bodies, headers and IPs — which here means message text, phone numbers
  and bearer tokens.
- `attachScreenshot` and `attachViewHierarchy` are off on mobile. Both
  would capture an open conversation verbatim.
- Console breadcrumbs are dropped on mobile, because on a chat screen they
  routinely contain message text and there is no way to tell which ones do.
- Phone-number-shaped strings are redacted to their last two digits in
  messages, exception values and URLs (`scrubText`).
- `hub.verify_token`, `token`, `access_token` and `signature` are redacted
  out of URLs on the backend (`sanitizeUrl`).
- The Sentry user is set from ids only — never email, display name or
  phone. Enough to tell that one crash hit forty users rather than one
  person forty times, and nothing more.

If you change any of these, you are changing what personal data leaves your
users' devices and your server. Treat it as a data-protection decision, not
a debugging convenience.
