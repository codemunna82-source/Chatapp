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
    /**
     * Meta's WebRTC offer for a call that is still ringing.
     *
     * Stored only because a socket event reaches a device that is awake,
     * and a call push does not: an agent whose app was closed opens it to
     * find the ring already delivered and gone, with no endpoint to read
     * the offer back from. This is that endpoint's source (see
     * findRingingCallForNumber).
     *
     * Cleared the moment the call is answered, declined or terminated —
     * it is worthless afterwards, and an SDP kept past its call is just an
     * unbounded blob on every historical row.
     */
    sdpOffer: { type: String },
    /**
     * Set only on a call carried over our own WebRTC signalling — the
     * customer in the web chat window rather than a real WhatsApp caller.
     *
     * Meta's calling API knows nothing about these, so `provider` reads
     * "web" and none of the Meta answer/hangup paths apply. The two are
     * kept in one collection because the agent's call history is one list
     * either way, and a second collection would have to be merged back
     * together on every read.
     */
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', index: true },
    /**
     * Which agent picked it up. A web call is signalled peer to peer after
     * the answer, so the server has to know which device to route the
     * remaining candidates to — the ringing broadcast goes to everyone who
     * may see the number, but the conversation that follows is with one
     * of them.
     */
    answeredByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
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
// The live web call for a conversation. Partial so the index holds only
// calls actually in flight rather than an entry per row ever written.
callLogSchema.index(
  { conversationId: 1, _id: -1 },
  { partialFilterExpression: { status: { $in: ['RINGING', 'ANSWERED'] } } },
);
// Sparse: only calls carry a provider id, and two different calls must
// never share one — this is the key a terminate webhook is matched on.
callLogSchema.index({ providerCallId: 1 }, { unique: true, sparse: true });
// The pending-call lookup on app resume: one ringing call, on one number,
// newest first. Partial rather than sparse so the index holds only the
// handful of calls actually ringing right now, not every row ever written.
callLogSchema.index(
  { whatsappPhoneNumberId: 1, _id: -1 },
  { partialFilterExpression: { status: 'RINGING' } },
);

export type CallLogDoc = HydratedDocument<InferSchemaType<typeof callLogSchema>>;
export const CallLog = model('CallLog', callLogSchema);
