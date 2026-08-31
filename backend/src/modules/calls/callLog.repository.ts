import { Types } from 'mongoose';
import { CallLog, type CallLogDoc } from './callLog.model';

export interface CreateCallLogInput {
  tenantId: string;
  contactId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  status: CallLogDoc['status'];
  duration?: number;
  startedAt?: Date;
  endedAt?: Date;
  providerCallId?: string;
  provider?: string;
  whatsappPhoneNumberId?: string;
  sdpOffer?: string;
}

export async function createCallLog(input: CreateCallLogInput): Promise<CallLogDoc> {
  return CallLog.create(input);
}

export async function findCallLogByIdAndTenant(id: string, tenantId: string): Promise<CallLogDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return CallLog.findOne({ _id: id, tenantId });
}

export async function listCallLogsByTenant(
  tenantId: string,
  opts: { cursor?: string; limit?: number } = {},
): Promise<{ items: CallLogDoc[]; nextCursor: string | null }> {
  const limit = Math.min(opts.limit ?? 30, 100);
  const filter: Record<string, unknown> = { tenantId };
  if (opts.cursor && Types.ObjectId.isValid(opts.cursor)) {
    filter._id = { $lt: new Types.ObjectId(opts.cursor) };
  }
  const items = await CallLog.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1);
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return { items: page, nextCursor: hasMore ? String(page[page.length - 1]!._id) : null };
}

/** Finds a call by Meta's own id, so a terminate webhook can close the row
 *  the connect webhook opened. */
export async function findCallLogByProviderId(providerCallId: string): Promise<CallLogDoc | null> {
  return CallLog.findOne({ providerCallId });
}

export interface CloseCallInput {
  status: CallLogDoc['status'];
  duration?: number;
  endedAt?: Date;
}

export async function closeCallLog(id: string, input: CloseCallInput): Promise<CallLogDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return CallLog.findByIdAndUpdate(id, { $set: input, $unset: { sdpOffer: '' } }, { new: true });
}

export async function setCallStatus(id: string, status: CallLogDoc['status']): Promise<CallLogDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  // $unset rather than setting null: the offer is only meaningful while
  // the call rings, and leaving the key present holding null would make
  // every reader have to treat "absent" and "null" as the same thing.
  return CallLog.findByIdAndUpdate(id, { $set: { status }, $unset: { sdpOffer: '' } }, { new: true });
}

/**
 * The call currently ringing on one number, if there is one.
 *
 * Bounded by age as well as status because a RINGING row is only closed by
 * Meta's terminate webhook, and a webhook that never arrives would leave a
 * stale call ringing on every app launch from then on. WhatsApp stops
 * ringing a caller well inside this window, so anything older is a row
 * that was never closed rather than a call anyone can still answer.
 */
export async function findRingingCallForNumber(
  whatsappPhoneNumberId: string,
  maxAgeMs: number,
): Promise<CallLogDoc | null> {
  if (!Types.ObjectId.isValid(whatsappPhoneNumberId)) return null;
  return CallLog.findOne({
    whatsappPhoneNumberId,
    status: 'RINGING',
    createdAt: { $gte: new Date(Date.now() - maxAgeMs) },
  }).sort({ _id: -1 });
}
