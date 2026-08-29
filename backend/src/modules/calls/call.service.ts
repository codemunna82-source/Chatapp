import { ApiError } from '../../lib/ApiError';
import { recordAudit } from '../audit/auditLog.service';
import { findUserByIdAndTenant } from '../users/user.repository';
import { pushCallStarted } from '../notifications/push.service';
import * as repo from './callLog.repository';
import * as contactRepo from '../contacts/contact.repository';
import { toPublicContact, type PublicContact } from '../contacts/contact.service';
import type { CallLogDoc } from './callLog.model';
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
