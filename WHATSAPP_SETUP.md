# Connecting WhatsApp, and giving each user their own number

This is the whole path from a fresh deployment to a team where every member
sends from their own WhatsApp number and sees only their own chats.

---

## 1. Server configuration

On Render → **Environment**:

```
META_ACCESS_TOKEN=<System User token from Meta>
META_APP_SECRET=<App Settings → Basic → App Secret>
META_VERIFY_TOKEN=<any long random string you choose>
META_MOCK_MODE=false
```

`META_MOCK_MODE` is the one that catches people out. It **defaults to
`true`**, and while it is true every send goes to a mock gateway: the app
reports success, the message row is stored, and nothing reaches WhatsApp.

`META_APP_SECRET` is not optional if you want to receive anything. Every
webhook Meta sends is HMAC-signed, and `verifySignature` rejects the lot
when the secret is unset — so without it the app can send but never hear
back.

Check what actually landed:

```
GET /api/webhooks/meta/health
```

It reports whether each secret is present and how long it is, never any
part of a value, so it is safe to open on a deployed URL.

Then point Meta's webhook at `https://<your-host>/api/webhooks/meta` using
the same verify token.

---

## 2. Register the real phone number

A fresh database is seeded with `phoneNumberId: DEMO-PHONE-000001`. That is
not a Meta id, so every send fails against it.

**Settings → WhatsApp number** (MASTER_ADMIN only) → paste the numeric
**Phone number ID** from Meta's dashboard (WhatsApp → API Setup) → *Verify
and save*.

The id is checked against Meta before it is stored — a `GET` on the number,
which proves both that the id exists and that `META_ACCESS_TOKEN` can reach
it. Meta's own error text comes back, so a typo fails immediately and says
which half is wrong:

| Meta says | What is wrong |
| --- | --- |
| `Unsupported get request` | The phone number id |
| `Invalid OAuth access token` | `META_ACCESS_TOKEN` |

The display number is read back from Meta rather than typed.

---

## 3. Create a user and assign them a number

**Settings → User management → Invite**. Set email, password, display name
and expiry as usual, then pick the number under **Sends from**. A number
can be registered inline from that same form, so this is one screen.

Give the member their email and password. On their next login:

- new chats they start go out from their assigned number;
- they see only that number's chats.

---

## Who sees what

| | Sees |
| --- | --- |
| MASTER_ADMIN | Every chat in the workspace |
| SUB_USER **with** an assigned number | Only that number's chats |
| SUB_USER **without** one | Every chat in the workspace |

Isolation is **opt-in per user**, and assigning a number is what switches
it on. That last row is deliberate: every user created before this feature
existed has no assignment, and defaulting them to "sees nothing" would
empty their inbox the moment you deployed.

The rule is enforced in four places, because filtering only the first would
leave the data reaching the device anyway:

- REST — the chat list query, and a guard on every route under
  `/conversations/:id` including all message routes;
- Socket.IO — a scoped user joins their number's room instead of the tenant
  room, so a colleague's message is never delivered to them at all, and
  `conversation:join` re-checks before granting a room;
- push notifications — addressed to the users who may see that number,
  because a lock screen is the one place a leak cannot be taken back;
- bulk actions — ids are narrowed before any write, so a chat cannot be
  archived or deleted by guessing its id.

**Known limitation:** the dashboard still counts the whole workspace.
Those are aggregate numbers — message and contact counts, response times —
not message content or customer identities. Scoping them per user is not
done.

Reassigning a user does **not** move their existing chats. The customer's
own WhatsApp thread is with the number it started on, and switching it
mid-conversation would read to them as a stranger taking over.

---

## What one access token can and cannot reach

`META_ACCESS_TOKEN` is a System User token. It reaches the numbers under
**your** WhatsApp Business Account, and nothing else.

- **Several numbers under your own WABA, one per user** — works with the
  setup above.
- **A client's own WABA** — your token cannot send from it, no matter how
  correct the phone number id is. The client must share their WABA with
  your Business Manager as a partner first; after that it behaves like one
  of your own numbers and step 2 applies unchanged.
- **Clients who will not share a WABA** — needs a per-client access token,
  which means Meta's Embedded Signup and encrypted per-tenant token
  storage. Not built.
