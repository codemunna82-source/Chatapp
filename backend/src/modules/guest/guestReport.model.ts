import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import type { Lean } from '../../lib/modelTypes';

/**
 * Why a customer reported a conversation.
 *
 * A closed list rather than free text alone, because the point of a report
 * is that someone can act on it: "spam" and "scam" go to different people
 * and carry different urgency, and a pile of prose has to be read one by
 * one before anyone knows which is which. The free-text `details` is still
 * there for what the categories cannot say.
 */
export const GUEST_REPORT_REASONS = [
  'SPAM',
  'SCAM_OR_FRAUD',
  'OFFENSIVE',
  'NOT_THE_BUSINESS',
  'OTHER',
] as const;
export type GuestReportReason = (typeof GUEST_REPORT_REASONS)[number];

export const GUEST_REPORT_STATUSES = ['OPEN', 'REVIEWED', 'DISMISSED'] as const;
export type GuestReportStatus = (typeof GUEST_REPORT_STATUSES)[number];

const guestReportSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true },
    /** Which link the report came through — the audit trail for "who sent this". */
    guestSessionId: { type: Schema.Types.ObjectId, ref: 'GuestSession', required: true },
    reason: { type: String, enum: GUEST_REPORT_REASONS, required: true },
    details: { type: String },
    /** The message being reported, when the customer picked one. */
    reportedMessageId: { type: Schema.Types.ObjectId, ref: 'Message' },
    /**
     * What that message said, copied at the moment of reporting.
     *
     * A reference alone is not enough for a report: the workspace can
     * delete the message, and the one thing a reviewer must be able to see
     * is the message that was complained about. Copying it is the whole
     * reason the report is evidence rather than a pointer to evidence.
     */
    reportedMessagePreview: { type: String },
    /** Whether the customer also blocked the business in the same action. */
    blocked: { type: Boolean, default: false },
    status: { type: String, enum: GUEST_REPORT_STATUSES, default: 'OPEN', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The listing: a workspace's open reports, newest first. Keyed on _id
// because that is what the query sorts and pages by, the same reasoning as
// the message and notification indexes.
guestReportSchema.index({ tenantId: 1, _id: -1 });
guestReportSchema.index({ tenantId: 1, status: 1, _id: -1 });

// Only createdAt, so this does not intersect the shared Timestamps helper:
// a report is a record of one moment and is never edited in place.
type GuestReportAttrs = InferSchemaType<typeof guestReportSchema> & { createdAt: Date };
export type GuestReportDoc = HydratedDocument<GuestReportAttrs>;
export type GuestReportLean = Lean<GuestReportAttrs>;
export const GuestReport = model('GuestReport', guestReportSchema);
