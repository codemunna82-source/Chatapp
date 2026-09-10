import { Types } from 'mongoose';
import { env } from '../../config/env';
import { CallLog, type CallLogDoc, type CallStatus } from './callLog.model';

/**
 * Calls carried over our own WebRTC signalling, between the customer's web
 * chat window and the agent's app.
 *
 * Entirely separate from the Meta path in call.service.ts, and
 * deliberately so: a WhatsApp call arrives as a webhook carrying Meta's
 * offer and is answered by calling Meta back, while this one is two
 * browsers-worth of SDP relayed over a socket that is already open. The
 * only thing they share is the CallLog collection, because the agent's
 * call history is one list either way.
 */

export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

/**
 * The ICE configuration both ends use.
 *
 * Served rather than baked into each client so the TURN credentials live
 * in one place. STUN alone is not enough here: unlike a WhatsApp call,
 * where Meta relays the media and each side only has to reach Meta, this
 * is a browser and a phone trying to reach each other across two NATs —
 * on mobile carrier networks that usually needs a relay.
 */
export function buildIceServers(): IceServerConfig[] {
  const servers: IceServerConfig[] = [];

  const stun = env.STUN_URLS.split(',').map((u) => u.trim()).filter(Boolean);
  if (stun.length > 0) servers.push({ urls: stun });

  const turn = env.TURN_URLS.split(',').map((u) => u.trim()).filter(Boolean);
  if (turn.length > 0) {
    servers.push({
      urls: turn,
      username: env.TURN_USERNAME || undefined,
      credential: env.TURN_CREDENTIAL || undefined,
    });
  }

  return servers;
}

/** True when a relay is actually configured — the difference between "calls work" and "calls connect silently". */
export function hasTurnConfigured(): boolean {
  return env.TURN_URLS.trim().length > 0;
}

/**
 * How long a call may sit ringing before it stops counting as live.
 *
 * Without this, a call nobody answers stays RINGING in the database
 * forever, and the "one call at a time per conversation" check then
 * refuses every future call on that conversation — one unanswered ring
 * permanently disabled calling for that customer. Sixty seconds is longer
 * than either client rings for, so a real call is never cut short by it.
 */
export const RINGING_TTL_MS = 60_000;

/**
 * How long an answered call may stay open before it stops counting as live.
 *
 * The ringing TTL only ever covered the ringing case, which left the same
 * hole one step further along: a call that connects and whose two ends
 * both vanish — a killed tab, a phone that lost signal — has no end event
 * and sits ANSWERED forever, refusing every future call on that
 * conversation. Four hours is far longer than any real call here and short
 * enough that a zombie clears the same day.
 */
export const ANSWERED_TTL_MS = 4 * 60 * 60 * 1000;

export interface StartWebCallInput {
  tenantId: string;
  conversationId: string;
  contactId: string;
  whatsappPhoneNumberId: string;
  /** INBOUND when the customer places it, OUTBOUND when the agent does. */
  direction: 'INBOUND' | 'OUTBOUND';
  /**
   * The caller's offer, kept only while the call rings.
   *
   * A socket event reaches an app that is open; a push reaches a phone
   * that is asleep and carries no offer. Without this, an agent woken by
   * the notification would open the app to a call they cannot answer.
   */
  sdpOffer?: string;
}

export async function startWebCall(input: StartWebCallInput): Promise<CallLogDoc> {
  return CallLog.create({
    tenantId: input.tenantId,
    contactId: input.contactId,
    conversationId: input.conversationId,
    whatsappPhoneNumberId: input.whatsappPhoneNumberId,
    direction: input.direction,
    status: 'RINGING',
    provider: 'web',
    sdpOffer: input.sdpOffer,
    startedAt: new Date(),
  });
}

/**
 * A call that is still live, looked up by id.
 *
 * Scoped to `provider: 'web'` so a Meta call id handed to these handlers
 * finds nothing — the two answer paths do completely different things,
 * and crossing them would post a browser's SDP to Meta.
 */
export async function findLiveWebCall(callId: string): Promise<CallLogDoc | null> {
  if (!Types.ObjectId.isValid(callId)) return null;
  return CallLog.findOne({
    _id: callId,
    provider: 'web',
    status: { $in: ['RINGING', 'ANSWERED'] },
  });
}

/**
 * The live call for a conversation, if any — what a second caller collides with.
 *
 * A ringing row older than RINGING_TTL_MS does not count: it is the
 * remains of a call whose caller closed the tab or lost the network, and
 * treating it as live would refuse every subsequent call on this
 * conversation for good.
 */
export async function findLiveWebCallForConversation(conversationId: string): Promise<CallLogDoc | null> {
  if (!Types.ObjectId.isValid(conversationId)) return null;
  const now = Date.now();
  const ringingSince = new Date(now - RINGING_TTL_MS);
  const answeredSince = new Date(now - ANSWERED_TTL_MS);
  return CallLog.findOne({
    conversationId,
    provider: 'web',
    $or: [
      { status: 'ANSWERED', startedAt: { $gte: answeredSince } },
      { status: 'RINGING', startedAt: { $gte: ringingSince } },
    ],
  }).sort({ _id: -1 });
}

/**
 * Routes an agent-placed call to the device that placed it, without
 * pretending it has been answered.
 *
 * The two are separate on purpose. The agent's app needs to be the one
 * device the customer's answer and candidates reach, which is what
 * answeredByUserId decides — but marking the call ANSWERED at the moment
 * it starts ringing makes every unanswered call record as a completed one,
 * with a duration counted from the ring. The status still moves when
 * somebody actually picks up.
 */
export async function claimWebCallForAgent(callId: string, userId: string): Promise<CallLogDoc | null> {
  if (!Types.ObjectId.isValid(callId)) return null;
  return CallLog.findOneAndUpdate(
    { _id: callId, provider: 'web', status: 'RINGING' },
    { $set: { answeredByUserId: userId } },
    { new: true },
  );
}

/**
 * Claims a ringing call for one agent.
 *
 * The status filter is the lock: two agents tapping answer at the same
 * moment both run this, and the second one matches nothing and is told
 * the call is gone rather than both of them being connected to it.
 */
export async function answerWebCall(callId: string, userId: string): Promise<CallLogDoc | null> {
  if (!Types.ObjectId.isValid(callId)) return null;
  return CallLog.findOneAndUpdate(
    { _id: callId, provider: 'web', status: 'RINGING' },
    {
      $set: { status: 'ANSWERED', answeredByUserId: userId, startedAt: new Date() },
      // Worthless once answered, and an SDP kept past its call is an
      // unbounded blob on every historical row.
      $unset: { sdpOffer: '' },
    },
    { new: true },
  );
}

/**
 * Closes a call out. `duration` is computed from the answer, not the ring,
 * so a call nobody picked up reports zero rather than however long it rang.
 */
export async function endWebCall(callId: string, status: CallStatus): Promise<CallLogDoc | null> {
  if (!Types.ObjectId.isValid(callId)) return null;
  const call = await CallLog.findOne({ _id: callId, provider: 'web' });
  if (!call || !['RINGING', 'ANSWERED'].includes(call.status)) return null;

  const endedAt = new Date();
  const answered = call.status === 'ANSWERED';
  call.status = status;
  call.endedAt = endedAt;
  call.sdpOffer = undefined;
  call.duration = answered && call.startedAt
    ? Math.max(0, Math.round((endedAt.getTime() - call.startedAt.getTime()) / 1000))
    : 0;
  await call.save();
  return call;
}
