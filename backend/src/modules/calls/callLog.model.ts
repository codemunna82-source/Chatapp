import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const CALL_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

/**
 * Provisional status set — spec §24 requires "support only statuses
 * actually supported by the provider." No real CallingProvider is wired in
 * yet (see architecture doc §6 / Phase 9), so this collection exists purely
 * so the schema, indexes, and repository are ready; it stays empty until a
 * real provider is integrated and this enum is reconciled with what that
 * provider actually reports.
 */
export const CALL_STATUSES = ['INITIATED', 'RINGING', 'ANSWERED', 'COMPLETED', 'MISSED', 'FAILED'] as const;
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
    provider: { type: String }, // e.g. "meta" once/if MetaCallingProvider is real
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

export type CallLogDoc = HydratedDocument<InferSchemaType<typeof callLogSchema>>;
export const CallLog = model('CallLog', callLogSchema);
