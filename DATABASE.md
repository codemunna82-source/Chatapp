# VOXO — Phase 2: Database Schema & Index Rationale

Status: models + tenant-scoped repositories implemented in `backend/src/modules/*`. This document lists every collection, its indexes, and the query pattern each index exists to serve — required by spec §37.

All 17 models register cleanly with no duplicate/conflicting index declarations (verified by importing every model module and dumping `schema.indexes()`).

## Collections

| Collection | Tenant-scoped? | Purpose |
|---|---|---|
| Tenant | — (is the tenant) | Top-level customer account |
| User | ✅ | Master Admin + Sub-users, auth, RBAC, validity window |
| RefreshToken | ✅ | Rotating refresh-token records, TTL-cleaned |
| AuditLog | ✅ | Append-only action trail |
| WhatsAppAccount | ✅ | One tenant ↔ one-or-more Meta WABAs |
| WhatsAppPhoneNumber | ✅ | Phone numbers under a WABA; **the webhook tenant-resolution key** |
| Contact | ✅ | A tenant's WhatsApp end-customers |
| Conversation | ✅ | One per (tenant, contact); carries the 24h window state |
| Message | ✅ | Chat messages, in and out |
| Media | ✅ | Uploaded/received media metadata |
| MessageTemplate | ✅ | Local mirror of Meta-approved templates |
| CallLog | ✅ | Call history (schema ready; empty until Phase 9 wires a real provider) |
| Subscription | ✅ | Tenant-level plan/billing record |
| Wallet / WalletTransaction | ✅ | Balance + append-only ledger |
| Notification | ✅ | In-app/push notification records |
| WebhookEvent | partially* | Raw Meta deliveries — tenant resolved post-hoc, see below |

\* `WebhookEvent` is written before tenant is known (Meta's payload only carries `phone_number_id`), so it can't be tenant-filtered at write time. It is the **one deliberate exception** to "every tenant-owned query is tenant-scoped" — see `whatsapp.repository.ts: findPhoneNumberByMetaId()`, whose result becomes the trusted tenant boundary for everything the webhook does next.

## Index-by-index rationale

**Tenant**
- `{slug:1}` unique — tenant lookup by URL-safe identifier.

**User**
- `{email:1}` unique — global (not per-tenant) uniqueness, because `POST /api/auth/login` takes only `{email, password}` with no tenant selector; the login lookup must resolve to exactly one account without prior tenant context.
- `{tenantId:1}` — every list/aggregate scoped to a tenant.
- `{tenantId:1, status:1}` — "active users" / "disabled users" filters on the admin's user-management screen.

**RefreshToken**
- `{jti:1}` unique — O(1) lookup of the specific token presented at `/auth/refresh`.
- `{family:1}` — bulk-revoke every token in a session lineage on reuse-detected theft or password change.
- `{expiresAt:1}` TTL (`expireAfterSeconds:0`) — automatic cleanup of expired tokens without a cron job.

**AuditLog**
- `{tenantId:1, createdAt:-1}` — the audit log screen (spec §33) reads recent-first, scoped to the viewing tenant.

**WhatsAppAccount**
- `{wabaId:1}` unique — Meta's WABA id must map to exactly one of our accounts.

**WhatsAppPhoneNumber**
- `{phoneNumberId:1}` unique — **the single most important index for correctness**: every inbound webhook and every outbound send correlates through Meta's `phone_number_id`, and this is how a webhook resolves "which tenant is this event for" in O(1) before touching any tenant-owned collection.

**Contact**
- `{tenantId:1, phone:1}` unique — a phone number identifies one contact per tenant; also the dedupe key for `findOrCreateContactByPhone` on inbound messages.
- `{tenantId:1, name:1}` — name-prefix search on the contacts screen.
- `{tenantId:1, createdAt:-1}` — default recent-first contact list.

**Conversation**
- `{tenantId:1, contactId:1}` unique — one conversation per (tenant, contact); also the lookup `findOrCreateConversation` uses on every inbound message.
- `{tenantId:1, updatedAt:-1}` — default chat-list ordering (most recently active first).
- `{tenantId:1, pinned:1, lastMessageAt:-1}` — pinned-first chat list (spec §19), so pinned conversations don't require a full collection scan to surface.

**Message**
- `{tenantId:1, conversationId:1, createdAt:-1}` — **the hottest query in the app**: cursor-paginated chat history for one open conversation. Composite so Mongo can satisfy the filter and the sort from a single index without an in-memory sort stage.
- `{tenantId:1, createdAt:-1}` — recent-activity feeds and dashboard aggregations.
- `{metaMessageId:1}` unique, sparse — every Meta status webhook (`sent`/`delivered`/`read`/`failed`) arrives keyed by `wamid`; sparse because inbound messages and not-yet-sent outbound messages don't have one yet.

**Media**
- `{tenantId:1, createdAt:-1}` — recent uploads.
- `{metaMediaId:1}` sparse — correlate Meta's media id back to our record.
- `{tenantId:1, sha256:1}` — dedupe identical files re-uploaded within a tenant (`findMediaBySha256`).

**MessageTemplate**
- `{tenantId:1, status:1}` — "approved templates only" is the filter the send-template UI actually needs.
- `{tenantId:1, name:1, language:1}` unique — Meta itself scopes template identity by (name, language); mirrors that so `upsertTemplate` is idempotent.

**CallLog**
- `{tenantId:1, createdAt:-1}` — call history list.
- `{tenantId:1, contactId:1, createdAt:-1}` — "calls with this contact" view.

**Subscription**
- `{tenantId:1, createdAt:-1}` — `getCurrentSubscription` takes the most recent row for a tenant.

**Wallet**
- `{tenantId:1}` unique — one wallet per tenant.

**WalletTransaction**
- `{tenantId:1, createdAt:-1}` and `{walletId:1, createdAt:-1}` — the wallet ledger/statement view, and reconciling a specific wallet's balance from its transactions.

**Notification**
- `{tenantId:1, userId:1, createdAt:-1}` — a user's notification feed.
- `{tenantId:1, userId:1, readAt:1}` — unread-count / unread-only filter.

**WebhookEvent**
- `{metaEventId:1}` unique — **the idempotency guarantee** (spec §16): Meta's at-least-once delivery means duplicates are expected and must be guaranteed no-ops. `recordWebhookEventOnce()` relies on this index's duplicate-key error rather than a separate existence check, so the guarantee holds even under concurrent delivery of the same event.
- `{phoneNumberId:1}` — supports resolving/debugging "all events for this number."
- `{tenantId:1, createdAt:-1}` — once resolved, per-tenant webhook activity for debugging.

## Repository pattern (spec §13)

Every repository method in `backend/src/modules/*/*.repository.ts` takes `tenantId` as an explicit parameter and folds it into the Mongo filter — there is no `Model.findById(id)` call anywhere in the codebase for a tenant-owned collection. The one intentional exception is documented above (`findPhoneNumberByMetaId`), and its result is exactly the boundary the rest of the webhook pipeline trusts.

## Demo seed data

`npm run seed` (outside `NODE_ENV=production`) now also creates: a demo `WhatsAppAccount` + `WhatsAppPhoneNumber` (clearly fake Meta ids — never real credentials), 2 `Contact`s, 1 `Conversation` with an inbound + outbound `Message` (exercising `recordInboundActivity`/`recordOutboundActivity` and the 24h window fields), 1 approved `MessageTemplate`, a `PRO` `Subscription`, and a `$100` `Wallet` credit — so the Android chat UI and dashboard have real data to render against once built.

## Known gap in this sandbox

The Jest suite (including a future tenant-isolation test extended to these new collections) could not be executed in this development session — `mongodb-memory-server` needs to download a `mongod` binary from `fastdl.mongodb.org`, which this session's network policy blocks, and no local Docker daemon is available as a fallback. In lieu of that, every model module was imported directly and `mongoose.modelNames()` / `schema.indexes()` were inspected to confirm all 17 models register without conflicts, and `tsc`, `eslint`, and `npm run build` are all clean. The suite will run normally (`npm test`) in your local environment or CI once network/Docker access is available.
