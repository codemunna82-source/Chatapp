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

export interface StartWebCallInput {
  tenantId: string;
  conversationId: string;
  contactId: string;
  whatsappPhoneNumberId: string;
  /** INBOUND when the customer places it, OUTBOUND when the agent does. */
  direction: 'INBOUND' | 'OUTBOUND';
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

/** The live call for a conversation, if any — what a second caller collides with. */
export async function findLiveWebCallForConversation(conversationId: string): Promise<CallLogDoc | null> {
  if (!Types.ObjectId.isValid(conversationId)) return null;
  return CallLog.findOne({
    conversationId,
    provider: 'web',
    status: { $in: ['RINGING', 'ANSWERED'] },
  }).sort({ _id: -1 });
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
    { $set: { status: 'ANSWERED', answeredByUserId: userId, startedAt: new Date() } },
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
  call.duration = answered && call.startedAt
    ? Math.max(0, Math.round((endedAt.getTime() - call.startedAt.getTime()) / 1000))
    : 0;
  await call.save();
  return call;
}
