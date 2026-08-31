# Voice calling in VOXO

A customer calls the WhatsApp Business number; the call rings inside VOXO
on the phone of the agent that number is assigned to; the agent answers in
the app. The audio never touches the backend — the server only carries two
SDP strings between Meta and the phone.

This is Meta's own **WhatsApp Business Calling** API. It is not a
third-party dialler, there is no per-minute charge, and the customer does
not need anything but WhatsApp.

---

## Turn calling on — it is OFF by default

This is the one step that makes calling look broken when it is skipped.
**Every** number starts with calling disabled, test numbers included. A
number that sends and receives messages perfectly will never ring, and
nothing in its status or quality rating says why.

Check a number:

```
curl "https://graph.facebook.com/v23.0/<PHONE_NUMBER_ID>/settings?fields=calling" \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

Turn it on:

```
curl -X POST "https://graph.facebook.com/v23.0/<PHONE_NUMBER_ID>/settings" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"calling":{"status":"ENABLED","call_icon_visibility":"DEFAULT"}}'
```

`call_icon_visibility: DEFAULT` is what puts the call button in the
customer's chat. Without it the number can technically take calls that
nobody has any way to place.

The backend has both of these as gateway methods
(`getCallingSettings` / `setCallingEnabled` in
`backend/src/integrations/meta/phoneNumbers.ts`). There is no admin screen
for them yet — the curl above is the way to flip it today.

## Subscribe to the `calls` webhook field

In **Meta → WhatsApp → Configuration → Webhooks**, the app must be
subscribed to **`calls`** as well as `messages`. Without it Meta accepts
the call and never tells VOXO about it.

## Where calling is not available

Meta excludes some markets: **USA, Canada, Turkey, Egypt, Vietnam,
Nigeria**. India is not excluded. A number in an excluded market returns no
`calling` object at all from the settings read above — which is different
from `DISABLED`, and is why the code reports it as unknown rather than off.

---

## What happens on a call, end to end

1. Meta posts a webhook with `field: "calls"` carrying the call id and a
   WebRTC **offer** (`session.sdp`).
2. The backend records a `RINGING` call log against the number the call
   arrived on, and stores the offer on it — briefly, see below.
3. Two things go out at once, because they cover different devices:
   - a `call:incoming` socket event, which reaches an app that is open;
   - an FCM push, which reaches a phone that is asleep.
   Both are addressed to the number, so only the agent that number is
   assigned to is disturbed.
4. The app puts up the full-screen call sheet and rings.
5. On **Answer**, the phone opens its microphone, produces a WebRTC
   **answer**, and posts it to `POST /api/calls/:callId/answer`. The
   backend calls Meta's `pre_accept` then `accept`.
6. Audio flows directly between the phone and Meta.
7. **End** posts to `/hangup`; Meta's terminate webhook then writes the
   real duration into the call log.

### The stored offer

A ringing call log keeps its SDP offer, and only while it rings. It is
there for one case: the agent's app was closed, so the socket event was
delivered to nothing, and a push notification carries no offer. On
foreground the app asks `GET /api/calls/pending` and picks the call up.

The offer is `$unset` the moment the call is answered, declined or
terminated, and the pending lookup ignores anything older than 45 seconds —
WhatsApp has stopped ringing the caller well before that, so an older
`RINGING` row is a webhook that never arrived, not a call anyone can still
answer.

---

## Who can answer what

Exactly the same rule as chats: a call belongs to the number it arrived
on, and a user sees only the number assigned to them. `answer`, `reject`
and `hangup` each re-check that before touching Meta, and answer **404**
for a call on someone else's number — the call id comes from the client,
and a push notification is not proof of ownership.

MASTER_ADMIN, having no number of their own, gets no pending call. Taking
a colleague's ringing call away from them would be worse than missing it.

---

## Limits worth knowing before you demo it

- **One call at a time.** A second ring while one is live is ignored — far
  more often a redelivered webhook than a real second caller, and either
  way replacing a live call would drop a conversation in progress.
- **Earpiece only.** There is a mute button, no speaker button.
  react-native-webrtc exposes no audio-route control, and a speaker button
  that silently did nothing would be worse than none. Use a headset for
  hands-free; adding a real toggle means another native module.
- **Outbound calls still hand off to WhatsApp.** Pressing call in VOXO
  opens the customer's chat in the real WhatsApp app. Calling *out*
  through the API needs the customer's permission first, which is not
  built.
- **The ring only rings while VOXO is installed and signed in.** There is
  no CallKit/ConnectionService integration, so a call does not appear on
  the lock screen the way a normal phone call does — it is a push
  notification plus the app's own call screen.

---

## When it does not ring

Work down this list; each item has caught a real case.

1. `GET /<PHONE_NUMBER_ID>/settings?fields=calling` returns
   `status: ENABLED`. If it returns no `calling` object, the number's
   market does not support calling.
2. The app is subscribed to the **`calls`** webhook field.
3. The Render log shows `Inbound WhatsApp call ringing` when you call the
   number. If it does not, the webhook is not arriving — that is a Meta
   configuration problem, not an app one.
4. The agent has a number assigned in **Team → their user → Sends from**.
   A user with no number sees no calls at all.
5. The phone granted microphone permission. A denied mic surfaces as a
   failure to answer, not as a silent call.
