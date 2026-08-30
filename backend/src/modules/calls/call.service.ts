import { ApiError } from '../../lib/ApiError';
import { logger } from '../../lib/logger';
import { getRealtimeEmitter } from '../../realtime/events';
import { getMetaGateway } from '../../integrations/meta';
import { resolveMetaCredentialsForPhoneNumber } from '../whatsapp/whatsapp.service';
import { visibleWhatsAppPhoneNumberId } from '../conversations/conversation.access';
import type { AuthContext } from '../../types/express';
import { recordAudit } from '../audit/auditLog.service';
import { findUserByIdAndTenant } from '../users/user.repository';
import { pushCallStarted, pushIncomingCall } from '../notifications/push.service';
import * as repo from './callLog.repository';
import * as contactRepo from '../contacts/contact.repository';
import { toPublicContact, type PublicContact } from '../contacts/contact.service';
import type { CallLogDoc } from './callLog.model';
import type { WhatsAppPhoneNumberDoc } from '../whatsapp/whatsappPhoneNumber.model';
import type { NormalizedCallItem } from '../../integrations/meta/webhookPayload';
import type { ContactLean } from '../contacts/contact.model';

const WHATSAPP_DEEPLINK_PROVIDER = 'whatsapp_deeplink';

export interface PublicCallLog {
  id: string;
  tenantId: string;
  contactId: string;
  contact?: PublicContact;
  direction: string;
  status: string;
  duration: number;
  startedAt?: Date;
  endedAt?: Date;
  provider?: string;
  createdAt: Date;
}

function toPublicCallLog(doc: CallLogDoc, contact?: ContactLean): PublicCallLog {
  return {
    id: String(doc._id),
    tenantId: String(doc.tenantId),
    contactId: String(doc.contactId),
    contact: contact ? toPublicContact(contact) : undefined,
    direction: doc.direction,
    status: doc.status,
    duration: doc.duration,
    startedAt: doc.startedAt ?? undefined,
    endedAt: doc.endedAt ?? undefined,
    provider: doc.provider ?? undefined,
    createdAt: doc.get('createdAt'),
  };
}

/** Batch-fetches contacts for a page of call logs — one query, not N (same pattern as conversation.service.ts). */
async function enrichWithContacts(tenantId: string, logs: CallLogDoc[]): Promise<PublicCallLog[]> {
  const contactIds = [...new Set(logs.map((l) => String(l.contactId)))];
  const contacts = await contactRepo.findContactsByIdsAndTenant(contactIds, tenantId);
  const byId = new Map(contacts.map((c) => [String(c._id), c]));
  return logs.map((l) => toPublicCallLog(l, byId.get(String(l.contactId))));
}

export interface ListCallsQuery {
  cursor?: string;
  limit?: number;
}

export async function listCallsForTenant(tenantId: string, query: ListCallsQuery) {
  const result = await repo.listCallLogsByTenant(tenantId, query);
  return { items: await enrichWithContacts(tenantId, result.items), nextCursor: result.nextCursor };
}

export interface InitiateCallResult {
  call: PublicCallLog;
  /**
   * A wa.me click-to-chat link (Meta's own documented mechanism —
   * developers.facebook.com/docs/whatsapp/business-platform/links) opened
   * on the device to hand off into the real WhatsApp app. It lands on the
   * chat with this contact, not directly in a call: no third-party app —
   * including this one — can start a live call inside WhatsApp itself,
   * only WhatsApp's own UI can. The user completes the call there.
   */
  deepLink: string;
}

/**
 * Logs the handoff and returns the real wa.me link for the mobile client
 * to open. Because the call itself happens inside WhatsApp (outside any
 * API this backend can observe), the logged status stays INITIATED
 * forever — there is no answer/duration/outcome webhook to reconcile it
 * against. That's an honest limitation, not a bug: recording "the agent
 * started a call handoff" is real; claiming to know how it ended would
 * not be.
 */
export async function initiateWhatsAppCall(
  tenantId: string,
  actorUserId: string,
  contactId: string,
): Promise<InitiateCallResult> {
  const contact = await contactRepo.findContactByIdAndTenant(contactId, tenantId);
  if (!contact) {
    throw ApiError.notFound('CONTACT_NOT_FOUND', 'Contact not found');
  }

  const doc = await repo.createCallLog({
    tenantId,
    contactId,
    direction: 'OUTBOUND',
    status: 'INITIATED',
    startedAt: new Date(),
    provider: WHATSAPP_DEEPLINK_PROVIDER,
  });

  await recordAudit({
    tenantId,
    actorUserId,
    action: 'call.initiated',
    targetType: 'CallLog',
    targetId: doc._id,
    metadata: { contactId },
  });

  // Tells the REST of the team, not the person who pressed the button. In
  // a shared inbox two agents calling the same customer minutes apart is a
  // real failure mode, and this is the only call event that exists here —
  // see pushCallStarted for why there is no incoming-call notification.
  const actor = await findUserByIdAndTenant(actorUserId, tenantId);
  await pushCallStarted({
    tenantId,
    actorUserId,
    actorName: actor?.displayName || actor?.email || 'A teammate',
    contactName: contact.name || contact.phone,
    contactId: String(contact._id),
  });

  const digits = contact.phone.replace(/^\+/, '');
  return {
    call: toPublicCallLog(doc, contact),
    deepLink: `https://wa.me/${digits}`,
  };
}

/**
 * The provider string for calls that came through WhatsApp Business
 * Calling, as opposed to the older deep-link handoff. Both appear in the
 * same history, and telling them apart matters: only one of them is a call
 * this app actually carried.
 */
const WHATSAPP_CALLING_PROVIDER = 'meta';

/**
 * An inbound call event from Meta — a ring, or the end of one.
 *
 * The SDP offer is forwarded to the agent's device and answered there; the
 * server never touches the audio. What it does own is *whose* call this is:
 * the number it arrived on decides that, exactly as it does for messages,
 * so a colleague's call never rings on the wrong phone.
 */
export async function handleInboundCallEvent(
  tenantId: string,
  phoneNumberDoc: WhatsAppPhoneNumberDoc,
  item: NormalizedCallItem,
): Promise<void> {
  const whatsappPhoneNumberId = String(phoneNumberDoc._id);

  if (item.event === 'connect') {
    const contact = await contactRepo.findOrCreateContactByPhone(tenantId, item.from, item.contactName);
    const call = await repo.createCallLog({
      tenantId,
      contactId: String(contact._id),
      direction: 'INBOUND',
      status: 'RINGING',
      startedAt: item.timestamp,
      providerCallId: item.callId,
      provider: WHATSAPP_CALLING_PROVIDER,
      whatsappPhoneNumberId,
    });

    const payload = {
      callId: item.callId,
      callLogId: String(call._id),
      contactId: String(contact._id),
      contactName: contact.name ?? undefined,
      fromPhone: item.from,
      sdpOffer: item.sdpOffer,
    };

    getRealtimeEmitter().emitCallIncoming(tenantId, payload, whatsappPhoneNumberId);

    // A ringing call is the one notification that cannot wait for the app
    // to be opened, so it goes out even though the socket event above has
    // already fired: the socket only reaches a device with the app alive.
    await pushIncomingCall({
      tenantId,
      whatsappPhoneNumberId,
      contactId: String(contact._id),
      contactName: contact.name ?? item.from,
      callId: item.callId,
    });

    logger.info({ tenantId, callId: item.callId }, 'Inbound WhatsApp call ringing');
    return;
  }

  // terminate
  const existing = await repo.findCallLogByProviderId(item.callId);
  if (!existing) {
    // A terminate with no connect: the call was never recorded, which
    // means this deployment did not see the ring. Logged rather than
    // fabricated — inventing a call row here would put a call in the
    // history that nobody in this workspace was ever offered.
    logger.warn({ callId: item.callId }, 'Call terminate for an unknown call — ignoring');
    return;
  }

  await repo.closeCallLog(String(existing._id), {
    status: toCallStatus(item.status, existing.status),
    duration: item.durationSeconds ?? existing.duration ?? 0,
    endedAt: item.timestamp,
  });

  getRealtimeEmitter().emitCallEnded(
    tenantId,
    {
      callId: item.callId,
      callLogId: String(existing._id),
      contactId: String(existing.contactId),
      fromPhone: item.from,
      status: item.status,
      durationSeconds: item.durationSeconds,
    },
    whatsappPhoneNumberId,
  );
}

/**
 * Maps Meta's own outcome string onto our status set.
 *
 * Falls back to the status the row already had rather than guessing:
 * a call that was ANSWERED and then ends with a word we do not recognise
 * is far more likely to have COMPLETED than to have FAILED, and recording
 * it as a failure would quietly corrupt every call report built on top.
 */
function toCallStatus(metaStatus: string | undefined, current: CallLogDoc['status']): CallLogDoc['status'] {
  switch ((metaStatus ?? '').toUpperCase()) {
    case 'COMPLETED':
      return 'COMPLETED';
    case 'REJECTED':
      return 'REJECTED';
    case 'MISSED':
    case 'NO_ANSWER':
      return 'MISSED';
    case 'FAILED':
      return 'FAILED';
    default:
      return current === 'ANSWERED' ? 'COMPLETED' : current === 'RINGING' ? 'MISSED' : current;
  }
}

/**
 * Answers a ringing call with the SDP the device produced.
 *
 * Two Meta calls, in Meta's order: pre_accept starts media flowing while
 * the device finishes setting up, then accept connects. pre_accept failing
 * is not fatal — it is an optimisation, and losing it costs the caller a
 * second of silence rather than the call.
 */
export async function answerCallForUser(
  auth: AuthContext,
  callId: string,
  sdpAnswer: string,
): Promise<PublicCallLog> {
  const call = await loadOwnCall(auth, callId);
  const creds = await resolveMetaCredentialsForPhoneNumber(
    auth.tenantId,
    String(call.whatsappPhoneNumberId),
  );
  const gateway = getMetaGateway();

  try {
    await gateway.preAcceptCall(creds, callId, sdpAnswer);
  } catch (err) {
    logger.warn({ err, callId }, 'pre_accept failed — continuing to accept');
  }
  await gateway.acceptCall(creds, callId, sdpAnswer);

  const updated = await repo.setCallStatus(String(call._id), 'ANSWERED');
  return toPublicCallLog(updated ?? call);
}

/** Declines a ringing call. Meta then sends a terminate webhook. */
export async function rejectCallForUser(auth: AuthContext, callId: string): Promise<PublicCallLog> {
  const call = await loadOwnCall(auth, callId);
  const creds = await resolveMetaCredentialsForPhoneNumber(
    auth.tenantId,
    String(call.whatsappPhoneNumberId),
  );
  await getMetaGateway().rejectCall(creds, callId);
  const updated = await repo.setCallStatus(String(call._id), 'REJECTED');
  return toPublicCallLog(updated ?? call);
}

/** Hangs up a connected call. The terminate webhook records the duration. */
export async function hangUpCallForUser(auth: AuthContext, callId: string): Promise<PublicCallLog> {
  const call = await loadOwnCall(auth, callId);
  const creds = await resolveMetaCredentialsForPhoneNumber(
    auth.tenantId,
    String(call.whatsappPhoneNumberId),
  );
  await getMetaGateway().terminateCall(creds, callId);
  return toPublicCallLog(call);
}

/**
 * The call, only if it belongs to this user's number.
 *
 * The call id comes from the client, so without this an agent could answer
 * a colleague's ringing call by guessing — or by replaying an id from a
 * push they should never have received. Same 404-not-403 rule as chats.
 */
async function loadOwnCall(auth: AuthContext, callId: string): Promise<CallLogDoc> {
  const call = await repo.findCallLogByProviderId(callId);
  const scope = visibleWhatsAppPhoneNumberId(auth);
  const ownedByTenant = call && String(call.tenantId) === auth.tenantId;
  const visible = !scope || (call && String(call.whatsappPhoneNumberId) === scope);
  if (!call || !ownedByTenant || !visible) {
    throw ApiError.notFound('CALL_NOT_FOUND', 'Call not found');
  }
  if (!call.whatsappPhoneNumberId) {
    // A deep-link handoff row from the old flow — there is no live call to
    // act on, and pretending otherwise would send Meta an id it never issued.
    throw ApiError.badRequest('CALL_NOT_LIVE', 'That call was not placed through WhatsApp calling.');
  }
  return call;
}
