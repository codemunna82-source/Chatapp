import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const CALL_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

/**
 * Reconciled with what WhatsApp Business Calling actually reports.
 * REJECTED is its own outcome, not a flavour of MISSED: an agent who
 * declined and an agent who never picked up are different facts, and a
 * call report that conflates them is misleading.
 */
export const CALL_STATUSES = [
  'INITIATED',
  'RINGING',
  'ANSWERED',
  'COMPLETED',
  'MISSED',
  'REJECTED',
  'FAILED',
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

const callLogSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    direction: { type: String, enum: CALL_DIRECTIONS, required: true },
    status: { type: String, enum: CALL_STATUSES, required: true },
    duration: { type: Number, default: 0 }, // seconds
    startedAt: { type: Date },
    endedAt: { type: Date },
    providerCallId: { type: String },
    provider: { type: String }, // "meta" for WhatsApp Business Calling
    /**
     * Which number the call came in on. Carried for the same reason
     * conversations carry it: it is what decides whose call this is, and a
     * call log that ignored it would show every agent every colleague's
     * calls.
     */
    whatsappPhoneNumberId: { type: Schema.Types.ObjectId, ref: 'WhatsAppPhoneNumber', index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Keyed on _id because that is what the list actually sorts and paginates
// by (`.sort({_id:-1})` with an `_id < cursor` range). The createdAt index
// this replaces matched the filter but not the sort, so every page loaded
// the whole matching set and sorted it in memory. ObjectId order is
// insertion order, so the rows come back in exactly the same sequence.
callLogSchema.index({ tenantId: 1, _id: -1 });
callLogSchema.index({ tenantId: 1, contactId: 1, createdAt: -1 });
// Sparse: only calls carry a provider id, and two different calls must
// never share one — this is the key a terminate webhook is matched on.
callLogSchema.index({ providerCallId: 1 }, { unique: true, sparse: true });

export type CallLogDoc = HydratedDocument<InferSchemaType<typeof callLogSchema>>;
export const CallLog = model('CallLog', callLogSchema);
