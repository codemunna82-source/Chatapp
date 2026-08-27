# VOXO — Phase 0: System Architecture

Status: **DRAFT — awaiting approval before Phase 1 (Backend Foundation) begins.**
No application code has been written yet. This document is the architecture contract for everything that follows.

---

## 1. High-Level System Architecture

```
                         ┌───────────────────────────────┐
                         │   Android App (VOXO)           │
                         │   React Native + TypeScript    │
                         │   (Expo Dev Client, not Go)    │
                         └───────────────┬─────────────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    │ HTTPS REST (Axios)  │  Socket.IO (WSS, JWT)│
                    ▼                     │                      ▼
        ┌────────────────────────────────┴────────────────────────────┐
        │                Node.js / TypeScript / Express API             │
        │  ── Auth (JWT) ── Tenant Resolver ── RBAC ── Rate Limiter ──   │
        │  ── Controllers → Services → Repositories (tenant-scoped) ──  │
        │  Socket.IO Gateway (Redis adapter, room-based, JWT verified)   │
        └───────┬───────────────┬───────────────┬────────────┬─────────┘
                │               │               │            │
                ▼               ▼               ▼            ▼
         ┌───────────┐   ┌────────────┐  ┌────────────┐ ┌──────────────┐
         │ MongoDB   │   │ Redis       │  │ BullMQ      │ │ Meta Cloud   │
         │ (Mongoose)│   │ (cache +    │  │ Workers     │ │ API (Graph)  │
         │ tenant-   │   │ sessions +  │  │ (webhook,   │ │ /messages    │
         │ scoped    │   │ pub/sub for │  │  media,     │ │ /media       │
         │ collections│  │  Socket.IO) │  │  notif, sub │ │ /templates   │
         └───────────┘   └────────────┘  │  expiry)    │ └──────┬───────┘
                                          └─────────────┘        │
                                                                  │ Webhook (HTTPS)
                                                                  ▼
                                                   POST /api/webhooks/meta
                                                   (signature verified,
                                                    idempotent, tenant-resolved)
```

Two independently deployable units:

1. **`backend/`** — Node.js/TypeScript/Express API + Socket.IO gateway + BullMQ workers. Stateless HTTP layer; horizontally scalable behind a load balancer; Redis provides shared session/pub-sub state so multiple instances can run.
2. **`mobile/`** — React Native (TypeScript) Android application, built with an Expo Development Build (NOT Expo Go — required because push notifications, secure storage, and background handling need native modules Expo Go doesn't ship).

Repo layout (monorepo, single git repository):

```
/
├── backend/
│   ├── src/
│   │   ├── config/            # env loading + validation (zod)
│   │   ├── modules/           # feature-sliced: auth, users, tenants, contacts,
│   │   │                      #   conversations, messages, media, templates,
│   │   │                      #   calls, subscriptions, wallet, dashboard,
│   │   │                      #   webhooks, audit
│   │   │   └── <feature>/
│   │   │       ├── <feature>.model.ts
│   │   │       ├── <feature>.repository.ts   # every query takes tenantId
│   │   │       ├── <feature>.service.ts
│   │   │       ├── <feature>.controller.ts
│   │   │       ├── <feature>.routes.ts
│   │   │       ├── <feature>.validation.ts   # zod schemas
│   │   │       └── <feature>.test.ts
│   │   ├── integrations/
│   │   │   └── meta/           # Meta Cloud API client (isolated, mockable)
│   │   │       ├── metaClient.ts
│   │   │       ├── messages.ts
│   │   │       ├── media.ts
│   │   │       ├── templates.ts
│   │   │       ├── webhookVerifier.ts
│   │   │       ├── errors.ts
│   │   │       └── mock/
│   │   ├── sockets/
│   │   │   ├── socketServer.ts     # auth middleware, Redis adapter
│   │   │   ├── rooms.ts
│   │   │   └── events/
│   │   ├── queues/
│   │   │   ├── connection.ts       # ioredis + BullMQ
│   │   │   ├── webhook.queue.ts
│   │   │   ├── media.queue.ts
│   │   │   ├── notification.queue.ts
│   │   │   └── subscriptionExpiry.queue.ts
│   │   ├── middleware/         # auth, tenantContext, rbac, rateLimit,
│   │   │                       #   errorHandler, requestLogger, validate
│   │   ├── lib/                # jwt, argon2, logger (pino), mongoose connect
│   │   ├── docs/               # swagger/openapi generation
│   │   ├── app.ts
│   │   └── server.ts
│   ├── test/                   # jest + supertest, tenant-isolation suite
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── mobile/
│   ├── src/
│   │   ├── app/                 # React Navigation tree (stack/tab)
│   │   ├── screens/
│   │   │   ├── auth/
│   │   │   ├── chats/           # list + conversation screens
│   │   │   ├── contacts/
│   │   │   ├── dashboard/
│   │   │   ├── calls/
│   │   │   └── settings/
│   │   ├── components/          # FlashList rows, skeletons, message bubble…
│   │   ├── api/                 # axios instance, generated API types
│   │   ├── sockets/              # socket.io-client singleton + hooks
│   │   ├── store/                # zustand slices (auth, ui, chatDraft)
│   │   ├── queries/               # TanStack Query hooks per resource
│   │   ├── storage/               # MMKV + secure token storage
│   │   ├── navigation/            # deep link config (voxo://)
│   │   ├── theme/
│   │   └── utils/
│   ├── android/                  # native Android project (generated by
│   │                              #   `expo prebuild`, committed for release
│   │                              #   signing config)
│   ├── app.config.ts
│   ├── package.json
│   └── tsconfig.json
├── docker-compose.yml
├── .github/workflows/
├── docs/
│   └── (this file, API contract, ERD)
└── .env.example
```

---

## 2. Multi-Tenant Data Model & Relationships

```
Tenant (1) ──< User (many)
Tenant (1) ──< WhatsAppAccount (1..n)         # one tenant may hold multiple
WhatsAppAccount (1) ──< WhatsAppPhoneNumber (many)
Tenant (1) ──< Contact (many)
Tenant (1) ──< Conversation (many) ── Contact (1)
Conversation (1) ──< Message (many)
Message (0..1) ──< Media (1)                  # media messages reference Media
Tenant (1) ──< MessageTemplate (many)
Tenant (1) ──< CallLog (many) ── Contact (1)
Tenant (1) ──< Subscription (1 active)
Tenant (1) ──< Wallet (1) ──< WalletTransaction (many)
Tenant (1) ──< Notification (many) ── User
Tenant (1) ──< AuditLog (many)
(global, not tenant-scoped) WebhookEvent      # raw Meta payloads, tenant
                                               #   resolved post-hoc by
                                               #   phone_number_id lookup
```

**Every tenant-owned collection carries `tenantId` (ObjectId, indexed) and every repository method requires it as an explicit argument** — never inferred from the request body/query, always from `req.tenantContext` which the auth middleware derives from the verified JWT (Master Admin) or the user's `tenantId` field (Sub User). This is enforced at the repository layer, not just controllers, so a missed check in one route can't leak data.

### Model field sketches (data contract, not code)

**Tenant**: `_id, name, slug, status(ACTIVE|SUSPENDED), masterAdminId, createdAt, updatedAt`

**User**: `_id, tenantId, email, passwordHash, role(MASTER_ADMIN|SUB_USER), permissions[], status(ACTIVE|DISABLED), validFrom, validUntil, subscriptionStatus(ACTIVE|EXPIRING|EXPIRED|SUSPENDED), refreshTokenFamily, lastLoginAt, createdAt, updatedAt`

**WhatsAppAccount**: `_id, tenantId, wabaId (Meta WABA ID), businessName, accessTokenRef (encrypted/secret-manager reference, never raw in DB in plaintext logs), verifyToken, status, connectedAt`

**WhatsAppPhoneNumber**: `_id, tenantId, whatsappAccountId, phoneNumberId (Meta), displayPhoneNumber, qualityRating, status`

**Contact**: `_id, tenantId, phone (E.164), name, avatarUrl, tags[], createdAt, updatedAt` — index `tenantId+phone` unique

**Conversation**: `_id, tenantId, contactId, whatsappPhoneNumberId, lastMessageAt, lastCustomerMessageAt, conversationWindowExpiresAt, unreadCount, pinned, pinnedAt, status`

**Message**: `_id, tenantId, conversationId, senderId, recipientPhone, direction(IN|OUT), type, text, mediaId, metaMessageId, replyToMessageId, status(QUEUED|SENT|DELIVERED|READ|FAILED), error, createdAt, updatedAt`

**Media**: `_id, tenantId, metaMediaId, mimeType, sizeBytes, sha256, storageRef, status`

**MessageTemplate**: `_id, tenantId, name, language, category, status(APPROVED|PENDING|REJECTED), components (Meta template schema), metaTemplateId`

**CallLog**: `_id, tenantId, contactId, direction, status, duration, startedAt, endedAt, providerCallId, provider, createdAt`

**Subscription**: `_id, tenantId, plan, validFrom, validUntil, status, autoRenew`

**Wallet / WalletTransaction**: `_id, tenantId, balance` / `_id, tenantId, walletId, type(CREDIT|DEBIT), amount, reason, referenceId, createdAt`

**Notification**: `_id, tenantId, userId, type, title, body, data, readAt, createdAt`

**AuditLog**: `_id, tenantId, actorUserId, action, targetType, targetId, metadata, ip, createdAt`

**WebhookEvent**: `_id, metaEventId (unique, for idempotency), phoneNumberId, tenantId (resolved), payload, processedAt, status`

### Key indexes (query-pattern driven)

| Index | Serves |
|---|---|
| `{tenantId:1, createdAt:-1}` on Message, AuditLog, Notification | recent-first list endpoints |
| `{tenantId:1, conversationId:1, createdAt:-1}` on Message | paginated chat history (cursor = createdAt+_id) |
| `{tenantId:1, updatedAt:-1}` on Conversation | chat list sorted by activity |
| `{tenantId:1, pinned:1, lastMessageAt:-1}` on Conversation | pinned-first chat list |
| `{tenantId:1, phone:1}` unique on Contact | contact lookup + dedupe |
| `{metaMessageId:1}` unique sparse on Message | webhook status updates |
| `{metaEventId:1}` unique on WebhookEvent | webhook idempotency |
| `{tenantId:1, status:1}` on User | active/disabled filtering |
| `{tenantId:1}` on every tenant-scoped collection | baseline isolation + cheap tenant-wide scans |

---

## 3. Authentication, RBAC & Subscription Enforcement

- **JWT access token** (short-lived, ~15 min) carries `{ userId, tenantId, role }`. **JWT refresh token** (longer-lived, rotated on every use, stored hashed server-side per device) enables silent renewal; reuse of a superseded refresh token revokes the whole token family (theft detection).
- Android stores both tokens in **`expo-secure-store`** (Android Keystore-backed), never MMKV/AsyncStorage in plaintext.
- Every authenticated request runs: `verifyJWT → loadTenantContext → checkUserStatus(ACTIVE) → checkSubscriptionWindow(validFrom/validUntil) → checkPermission(route-level)`. A 401/403 with a typed `error.code` (`ACCOUNT_DISABLED`, `SUBSCRIPTION_EXPIRED`, `PERMISSION_DENIED`) is returned — enforcement lives entirely server-side; Android's countdown UI is cosmetic only.
- Socket.IO auth middleware performs the identical chain during the `connect` handshake (JWT passed in `auth` payload) and again periodically (short re-validation interval) so a mid-session expiry disconnects the socket, not just blocks new connects.
- RBAC: `MASTER_ADMIN` bypasses permission checks within their own tenant only (never cross-tenant). `SUB_USER` actions are checked against their `permissions[]` array (`CHAT_READ`, `CHAT_SEND`, …) via a route-level `requirePermission()` middleware.

---

## 4. Meta WhatsApp Cloud API Integration

`backend/src/integrations/meta/` isolates all Graph API calls behind a typed client so the rest of the app never talks to Meta directly.

- **Outgoing**: `messages.service` checks the 24-hour customer-service window (`conversationWindowExpiresAt` on `Conversation`, updated whenever an inbound message arrives) before allowing free-form sends; outside the window, only `type: template` requests are accepted, otherwise the API returns `MESSAGE_TEMPLATE_REQUIRED` as specified. All sends go through BullMQ for retry (exponential backoff) on transient Meta errors (rate limit, 5xx), with an idempotency key (our `_id`) to avoid duplicate sends on retry.
- **Media**: upload → Meta `/media` → store `metaMediaId` + our own `storageRef`/cache; retrieval proxies through our backend so Meta access tokens are never exposed to Android.
- **Errors**: Meta error codes are mapped to our typed `{success:false, error:{code,message}}` contract, never leaking raw Graph API payloads.
- **Multi-tenant Meta setup**: each `WhatsAppAccount` document maps one tenant to one Meta **WABA** (WhatsApp Business Account), with one or more `WhatsAppPhoneNumber`s under it. The realistic, Meta-supported onboarding path for letting external businesses connect their own WhatsApp number without us manually provisioning credentials is **Embedded Signup** (Meta's official Facebook Login for Business flow that returns a WABA ID + phone number ID + a system-user or code-exchanged access token scoped to that WABA). This is the only officially supported multi-tenant onboarding mechanism — building anything else (e.g. asking tenants to paste a permanent token) works for early customers but doesn't scale and isn't how Meta expects partners to onboard businesses. Phase 3 will implement Embedded Signup rather than any invented API.
- **Webhook** (`GET/POST /api/webhooks/meta`): GET performs the `hub.verify_token` challenge response Meta requires at subscription time. POST verifies the `X-Hub-Signature-256` HMAC against `META_APP_SECRET`, resolves the tenant from the `phone_number_id` in the payload (not from anything the client sends), records `metaEventId` in `WebhookEvent` for idempotency (duplicate deliveries are Meta's documented behavior and must be a no-op), then enqueues processing via BullMQ so the HTTP response returns fast (Meta expects <20s ack) and processing (status updates, inbound message persistence, Socket.IO emission) happens in a worker.

---

## 5. Real-Time Layer (Socket.IO)

- Server uses the **Redis adapter** so events fan out correctly across multiple API instances.
- Auth is JWT-based at handshake; on success the socket joins `tenant:{tenantId}` and `user:{userId}`; `conversation:{conversationId}` rooms are joined on demand when the client opens that screen (authorization re-checked server-side before the join is granted, never trusting the client's claimed IDs).
- Events (`message:new`, `message:updated`, `message:status`, `conversation:updated`, `conversation:read`, `typing:start/stop`, `notification:new`) are always emitted to the *room*, computed from server-side tenant context, never client-supplied.
- Reconnect: `socket.io-client` auto-reconnect with backoff; on reconnect the app re-authenticates and re-fetches conversation state via REST (delta by `updatedAt` cursor) to reconcile anything missed while disconnected — Socket.IO is a real-time notifier, not the source of truth.

---

## 6. Calling — Feasibility Assessment (per spec §23)

Standard WhatsApp Cloud API (the messaging Graph API used throughout this project) **does not include voice/video calling**. Meta has a separate, newer **WhatsApp Business Calling API**, which as of now is a limited/staged rollout requiring specific business eligibility and is not a self-serve capability available to every Cloud API app the way messaging is. Given that:

- We will **not fake calling**. No client-side WebRTC hack presented as "WhatsApp calling," no fabricated endpoints.
- We define a `CallingProvider` interface (`initiateCall`, `endCall`, `getCallStatus`, `onIncomingCall` webhook handler shape) so the calling *architecture* is real and pluggable.
- `MetaCallingProvider` will be implemented **only if/when Meta's Business Calling API access is confirmed available for this tenant's WABA** (checked at integration time against current Meta docs/eligibility — not assumed). Until then it exists as a documented stub that returns `CALLING_NOT_AVAILABLE`.
- `FutureCallingProvider` is a placeholder seam for a possible alternative (e.g. a non-Meta VoIP provider) if the product later needs calling independent of Meta's rollout — not implemented now, not claimed as working.
- `CallLog` and `GET /api/calls` are built regardless, so call history is ready the moment a real provider is wired in; they will simply show no rows until then.

This is the "closest officially supported architecture" called for in §51 given calling is not uniformly available.

---

## 7. Subscription/Validity, Wallet, Dashboard

- A scheduled BullMQ job (`subscriptionExpiry.queue`) sweeps tenants/users hourly, transitioning `ACTIVE → EXPIRING` (e.g. ≤3 days left) `→ EXPIRED`, and stamps `Notification` + `AuditLog` entries. This is a convenience cache; the *authoritative* check is always the live `validFrom/validUntil` comparison in the auth middleware, so a delayed sweep never allows unauthorized access.
- Wallet is a simple ledger (`Wallet.balance` denormalized, recomputed/reconciled from `WalletTransaction` sums) — used for future metered billing (e.g. per-message cost), scoped per tenant.
- `GET /api/dashboard` uses MongoDB aggregation pipelines (`$match tenantId` first, always, to use the tenant index before any grouping) for counts/time-series rather than pulling documents into app code.

---

## 8. Android Build & APK Strategy

- **Expo Development Build**, not Expo Go — required for `react-native-mmkv`, secure storage, notification channels, and background socket handling.
- `expo prebuild` generates the native `android/` project, which is committed so release signing config (`android/app/build.gradle` signing block, ProGuard/R8 rules) is version-controlled and reproducible outside of Expo's cloud (EAS) if needed.
- Release build command (Phase 11): `cd mobile/android && ./gradlew assembleRelease`, or `eas build --platform android --profile production` if using EAS.
- **Signing**: production requires a release keystore (`voxo-release.keystore`) plus its store/key passwords and key alias. **This environment does not have — and must never fabricate — a production keystore.** Phase 11 will produce the release-configured, unsigned (or debug-signed if Gradle's default is used for a smoke build) artifact and document the exact `keytool`/Gradle commands the user must run locally with their own keystore to produce `VOXO-release.apk` as a genuinely production-signed artifact. No fake signature will ever be claimed.
- Package name: `com.voxo.app`. App name: `VOXO`. No WhatsApp branding/logo — VOXO gets its own icon/splash placeholder.
- Deep linking scheme: `voxo://conversation/{conversationId}`, wired through both React Navigation linking config and notification tap handling; the target screen still calls the authenticated conversation-fetch endpoint, so a deep link alone grants no data access.

---

## 9. Security, Testing, DevOps Summary

- Helmet, CORS allowlist, per-route + per-tenant rate limiting, Zod validation on every input, Mongoose queries always parameterized (no raw `$where`/string interpolation) to prevent injection, Pino structured logging with redaction of `password`, `*token*`, `META_*` secret fields.
- Mandatory test: two seeded tenants, cross-tenant fetch attempts on every resource type must 403/404 — this suite gates CI.
- Docker Compose for local dev (API, Mongo, Redis, worker). GitHub Actions: PR = lint + typecheck + test; main = backend Docker build + Android release build + (if secrets present) deploy + health check (`GET /health`, `GET /ready`).
- `META_MOCK_MODE=true` in dev/test swaps `integrations/meta` for a mock implementation with clearly separated code paths (never silently mixed into the production client).

---

## 10. Open Items Requiring Your Approval Before Phase 1

1. **Embedded Signup vs. single-WABA-per-deployment**: confirm we should build for true multi-tenant Embedded Signup (more work, matches spec §15) rather than a simpler "we manually configure each tenant's Meta credentials" admin flow for an initial version.
2. **Calling**: confirm you're OK with Phase 9 shipping the `CallingProvider` architecture + empty call history rather than working calls, pending real Meta Business Calling API eligibility.
3. **APK signing**: confirm you understand Phase 11's release APK will not be production-signed without you supplying a keystore, and that's acceptable for this environment.
4. **Hosting target** for Phase 12 backend deployment (e.g. a specific VPS/Docker host, or just Docker Compose + instructions without an actual live deployment) — none was specified.

Reply with approval (and answers to the above) to proceed to **Phase 1 — Backend Foundation**.
