import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * A saved reply, shared across the whole tenant.
 *
 * Tenant-scoped rather than per-user on purpose: the value of a saved reply
 * is that the price list is worded the same way whoever sends it. A
 * per-agent library means five different answers to the same question and
 * every new team member starting from an empty list.
 */
const quickReplySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    /** Short label shown in the picker — what the agent scans for. */
    title: { type: String, required: true, trim: true, maxlength: 60 },
    /** The message body inserted into the composer. */
    body: { type: String, required: true, trim: true, maxlength: 4096 },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    /**
     * Bumped on each use so the picker can put what the team actually sends
     * at the top. A list ordered by creation date puts the reply someone
     * added first — not the one used fifty times a day — in front.
     */
    useCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

// Most-used first, then alphabetical — the picker's only sort order.
quickReplySchema.index({ tenantId: 1, useCount: -1, title: 1 });
// Titles are how agents identify a reply; two called "Price list" in the
// same workspace is a bug, not a feature.
quickReplySchema.index({ tenantId: 1, title: 1 }, { unique: true });

export type QuickReplyDoc = HydratedDocument<InferSchemaType<typeof quickReplySchema>>;
export const QuickReply = model('QuickReply', quickReplySchema);
