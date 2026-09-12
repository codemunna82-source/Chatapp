import { logger } from '../../lib/logger';
import { conversationRoom, tenantRoom, userRoom, phoneNumberRoom } from '../rooms';
import {
  startWebCall,
  answerWebCall,
  claimWebCallForAgent,
  endWebCall,
  findLiveWebCall,
  findLiveWebCallForConversation,
} from '../../modules/calls/webCall.service';
import { conversationVisibleTo, findConversationByIdAndTenant } from '../../modules/conversations/conversation.repository';
import { visibleWhatsAppPhoneNumberId } from '../../modules/conversations/conversation.access';
import { findContactByIdAndTenant } from '../../modules/contacts/contact.repository';
import { pushGuestIncomingCall } from '../../modules/guest/guestPush.service';
import { resolveBusinessNameForConversation } from '../../modules/guest/businessName';
import { pushIncomingCall } from '../../modules/notifications/push.service';
import {
  isConversationBlockedByGuest,
  isSessionBlocked,
} from '../../modules/guest/guestSession.repository';
import type { GuestContext } from '../../modules/guest/guest.service';
import type { AuthContext } from '../../types/express';
import type { AppServer, AppSocket } from '../types';

/**
 * Audio calls between the customer's web chat window and the agent's app.
 *
 * The server carries SDP and ICE candidates and nothing else — the audio
 * goes directly between the browser and the phone (via TURN when they
 * cannot reach each other, which on mobile networks is most of the time).
 *
 * Every event name here is prefixed `web:` and every call row is
 * `provider: 'web'`. That separation is load-bearing rather than tidiness:
 * the Meta calling path answers by posting an SDP back to Meta, and an
 * older build of the agent app that has never heard of these events will
 * simply not respond to them, instead of trying to hand a browser's offer
 * to Meta's API.
 */

type Ack = (res: { success: boolean; callId?: string; error?: string }) => void;

interface SdpPayload {
  callId?: string;
  sdp?: string;
}
interface IcePayload {
  callId?: string;
  candidate?: unknown;
}
interface CallIdPayload {
  callId?: string;
}

/** Everyone who may see this number's calls — where a ring is broadcast. */
const agentAudience = (io: AppServer, tenantId: string, whatsappPhoneNumberId: string) =>
  io.to(tenantRoom(tenantId)).to(phoneNumberRoom(whatsappPhoneNumberId));

/**
 * Where an agent-bound event goes once the call is answered: the one
 * device that took it. Before that there is no such device, so the ring
 * and a cancel still go to the whole audience.
 */
const agentTarget = (
  io: AppServer,
  call: { tenantId: unknown; whatsappPhoneNumberId?: unknown; answeredByUserId?: unknown },
) => {
  if (call.answeredByUserId) return io.to(userRoom(String(call.answeredByUserId)));
  // The number is optional on the schema even though every web call is
  // created with one. Falling back to the tenant room keeps a row that
  // somehow lacks it reaching someone, rather than the string "undefined"
  // becoming a room nobody is in.
  if (call.whatsappPhoneNumberId) {
    return agentAudience(io, String(call.tenantId), String(call.whatsappPhoneNumberId));
  }
  return io.to(tenantRoom(String(call.tenantId)));
};

/* ------------------------------------------------------------------ *
 * The customer's side                                                 *
 * ------------------------------------------------------------------ */

export function registerGuestCallHandlers(io: AppServer, socket: AppSocket, guest: GuestContext): void {
  /** The customer pressed call. Their offer rings every agent on the number. */
  socket.on('web:call:start', async (payload: SdpPayload, ack?: Ack) => {
    if (!payload?.sdp) {
      ack?.({ success: false, error: 'sdp is required' });
      return;
    }

    // The block covers calls too, and is read fresh rather than off the
    // context this socket resolved at connect: a customer who blocks
    // mid-session still has that socket open, and a check against the
    // stale copy would let the very next tap ring the agent anyway.
    if (await isSessionBlocked(guest.sessionId)) {
      ack?.({ success: false, error: 'You blocked this chat. Unblock it to call.' });
      return;
    }

    // One call at a time per conversation. A second start while one is
    // live is nearly always a double tap or a reconnect replaying, and
    // replacing a live call would drop a conversation in progress.
    const existing = await findLiveWebCallForConversation(guest.conversationId);
    if (existing) {
      ack?.({ success: false, error: 'A call is already in progress' });
      return;
    }

    const call = await startWebCall({
      tenantId: guest.tenantId,
      conversationId: guest.conversationId,
      contactId: guest.contactId,
      whatsappPhoneNumberId: guest.whatsappPhoneNumberId,
      direction: 'INBOUND',
      // Held only while it rings, so an agent woken by the push can pick
      // the call up from GET /calls/pending instead of finding a ring
      // that was delivered to a socket nobody had open.
      sdpOffer: payload.sdp,
    });
    const callId = String(call._id);

    const contact = await findContactByIdAndTenant(guest.contactId, guest.tenantId);
    const contactName = contact?.name || contact?.phone || 'Web chat';

    agentAudience(io, guest.tenantId, guest.whatsappPhoneNumberId).emit('web:call:incoming', {
      callId,
      conversationId: guest.conversationId,
      contactId: guest.contactId,
      contactName,
      sdp: payload.sdp,
    });

    ack?.({ success: true, callId });

    // A socket event reaches an app that is open; a push reaches a phone
    // that is asleep. A ringing call needs both, and the push is the one
    // that is time-critical.
    await pushIncomingCall({
      tenantId: guest.tenantId,
      whatsappPhoneNumberId: guest.whatsappPhoneNumberId,
      contactId: guest.contactId,
      contactName,
      callId,
      channel: 'web',
    });
  });

  /** The customer answering a call the agent placed. */
  socket.on('web:call:answer', async (payload: SdpPayload, ack?: Ack) => {
    const call = payload?.callId ? await findLiveWebCall(payload.callId) : null;
    if (!call || String(call.conversationId) !== guest.conversationId || !payload.sdp) {
      ack?.({ success: false, error: 'Call not found' });
      return;
    }

    // This is the moment the call is answered, and the row has to say so:
    // it is where the duration is measured from, and a call left RINGING
    // ages out of "live" after a minute and takes the conversation's
    // signalling with it. The agent it belongs to was recorded when they
    // placed it.
    const answered = call.answeredByUserId
      ? await answerWebCall(String(call._id), String(call.answeredByUserId))
      : null;

    agentTarget(io, answered ?? call).emit('web:call:answered', {
      callId: String(call._id),
      sdp: payload.sdp,
    });
    ack?.({ success: true });
  });

  socket.on('web:call:ice', async (payload: IcePayload) => {
    if (!payload?.callId || payload.candidate == null) return;
    const call = await findLiveWebCall(payload.callId);
    // The conversation on the call row, never one the client names — a
    // guest must not be able to trickle candidates into someone else's.
    if (!call || String(call.conversationId) !== guest.conversationId) return;
    agentTarget(io, call).emit('web:call:ice', { callId: String(call._id), candidate: payload.candidate });
  });

  socket.on('web:call:end', async (payload: CallIdPayload) => {
    if (!payload?.callId) return;
    const live = await findLiveWebCall(payload.callId);
    if (!live || String(live.conversationId) !== guest.conversationId) return;

    // MISSED when nobody had picked up yet — the customer gave up waiting,
    // which is a different fact from a call that happened and ended.
    const ended = await endWebCall(payload.callId, live.status === 'ANSWERED' ? 'COMPLETED' : 'MISSED');
    if (!ended) return;
    agentTarget(io, live).emit('web:call:ended', {
      callId: String(ended._id),
      status: ended.status,
      durationSeconds: ended.duration ?? 0,
    });
  });
}

/* ------------------------------------------------------------------ *
 * The agent's side                                                    *
 * ------------------------------------------------------------------ */

export function registerAgentWebCallHandlers(io: AppServer, socket: AppSocket, auth: AuthContext): void {
  const scope = () => visibleWhatsAppPhoneNumberId(auth);

  /** The agent calling a customer who has a web chat window open. */
  socket.on('web:call:invite', async (payload: SdpPayload & { conversationId?: string }, ack?: Ack) => {
    const conversationId = payload?.conversationId;
    if (!conversationId || !payload.sdp) {
      ack?.({ success: false, error: 'conversationId and sdp are required' });
      return;
    }
    if (!(await conversationVisibleTo(conversationId, auth.tenantId, scope()))) {
      ack?.({ success: false, error: 'Conversation not found' });
      return;
    }
    const conversation = await findConversationByIdAndTenant(conversationId, auth.tenantId);
    if (!conversation) {
      ack?.({ success: false, error: 'Conversation not found' });
      return;
    }
    if (await findLiveWebCallForConversation(conversationId)) {
      ack?.({ success: false, error: 'A call is already in progress' });
      return;
    }
    // The customer's block binds this direction too, and this is the only
    // place it can: the ring goes over a socket, not through the guest
    // HTTP routes where the flag is checked on every request.
    if (await isConversationBlockedByGuest(conversationId, auth.tenantId)) {
      ack?.({ success: false, error: 'This customer has blocked the web chat.' });
      return;
    }

    const call = await startWebCall({
      tenantId: auth.tenantId,
      conversationId,
      contactId: String(conversation.contactId),
      whatsappPhoneNumberId: String(conversation.whatsappPhoneNumberId),
      direction: 'OUTBOUND',
    });
    // Recorded against the agent who placed it, because that is the one
    // device the customer's answer and candidates have to reach — but the
    // call is still ringing, and marking it answered here would make every
    // call the customer ignores record as a completed one.
    await claimWebCallForAgent(String(call._id), auth.userId);

    // socket.to, not io.to: the agent placing the call is in this
    // conversation's room whenever they have the chat open, and io.to
    // would ring their own phone for the call they just placed.
    socket.to(conversationRoom(conversationId)).emit('web:call:incoming', {
      callId: String(call._id),
      conversationId,
      sdp: payload.sdp,
    });

    // And the customer's browser, for the case the socket above cannot
    // cover: the tab is closed, or backgrounded on a phone where it has
    // been frozen. A ring nobody is looking at is a missed call, and the
    // whole reason this window asks for notification permission.
    //
    // Not awaited into the ack. The call is already ringing on every open
    // tab, and a slow FCM round trip would hold the agent's own UI in
    // "connecting" for it.
    void pushGuestIncomingCall({
      tenantId: auth.tenantId,
      conversationId,
      // Resolved exactly as the window header is, so the ring and the page
      // it opens name the same business (see guest/businessName.ts).
      businessName: (
        await resolveBusinessNameForConversation(
          auth.tenantId,
          String(conversation.whatsappPhoneNumberId),
        )
      ).name,
      callId: String(call._id),
    });

    ack?.({ success: true, callId: String(call._id) });
  });

  /** The agent picking up a call the customer placed. */
  socket.on('web:call:answer', async (payload: SdpPayload, ack?: Ack) => {
    if (!payload?.callId || !payload.sdp) {
      ack?.({ success: false, error: 'callId and sdp are required' });
      return;
    }
    const live = await findLiveWebCall(payload.callId);
    if (
      !live ||
      String(live.tenantId) !== auth.tenantId ||
      !(await conversationVisibleTo(String(live.conversationId), auth.tenantId, scope()))
    ) {
      ack?.({ success: false, error: 'Call not found' });
      return;
    }

    // The status filter inside answerWebCall is the lock: two agents
    // tapping answer at the same moment, and the second is told the call
    // is gone rather than both being joined to it.
    const claimed = await answerWebCall(payload.callId, auth.userId);
    if (!claimed) {
      ack?.({ success: false, error: 'This call was already answered' });
      return;
    }

    socket.to(conversationRoom(String(claimed.conversationId))).emit('web:call:answered', {
      callId: String(claimed._id),
      sdp: payload.sdp,
    });
    ack?.({ success: true, callId: String(claimed._id) });
  });

  socket.on('web:call:reject', async (payload: CallIdPayload, ack?: Ack) => {
    if (!payload?.callId) return;
    const live = await findLiveWebCall(payload.callId);
    if (!live || String(live.tenantId) !== auth.tenantId) return;

    const ended = await endWebCall(payload.callId, 'REJECTED');
    if (!ended) return;
    socket.to(conversationRoom(String(ended.conversationId))).emit('web:call:ended', {
      callId: String(ended._id),
      status: 'REJECTED',
      durationSeconds: 0,
    });
    ack?.({ success: true });
  });

  socket.on('web:call:ice', async (payload: IcePayload) => {
    if (!payload?.callId || payload.candidate == null) return;
    const call = await findLiveWebCall(payload.callId);
    if (!call || String(call.tenantId) !== auth.tenantId) return;
    // Excluding the sender matters here more than anywhere: an agent in
    // the conversation room would otherwise be fed its own candidates back
    // and try to add them to its own connection.
    socket.to(conversationRoom(String(call.conversationId))).emit('web:call:ice', {
      callId: String(call._id),
      candidate: payload.candidate,
    });
  });

  socket.on('web:call:end', async (payload: CallIdPayload) => {
    if (!payload?.callId) return;
    const live = await findLiveWebCall(payload.callId);
    if (!live || String(live.tenantId) !== auth.tenantId) return;

    const ended = await endWebCall(payload.callId, live.status === 'ANSWERED' ? 'COMPLETED' : 'REJECTED');
    if (!ended) return;
    socket.to(conversationRoom(String(ended.conversationId))).emit('web:call:ended', {
      callId: String(ended._id),
      status: ended.status,
      durationSeconds: ended.duration ?? 0,
    });
    logger.debug({ callId: String(ended._id) }, 'Web call ended by agent');
  });
}
