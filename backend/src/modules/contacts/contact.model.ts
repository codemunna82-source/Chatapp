import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import type { Timestamps, Lean } from '../../lib/modelTypes';

const contactSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    /**
     * The User whose connected WhatsApp number this belongs to.
     *
     * Optional: rows written before per-user numbers existed have none.
     * The backfill assigns them to the tenant's MASTER_ADMIN, and until it
     * runs a missing value reads as admin-owned rather than orphaned.
     */
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    phone: { type: String, required: true, trim: true }, // E.164, e.g. +14155551234
    name: { type: String, trim: true },
    /**
     * Seeded sample data, not a real customer.
     *
     * A demo number is not on WhatsApp, so anything sent to it would fail
     * at Meta — and before that, the 24-hour window it was seeded inside
     * closes a day later and the chat starts insisting on an approved
     * template that could never be delivered either. Both are true and both
     * are useless noise on data whose only job is to show what the app
     * looks like.
     *
     * So a demo conversation is treated as a local sandbox: no window
     * enforcement, and sends go through the mock gateway whatever
     * META_MOCK_MODE says (see message.service.ts). Nothing about a demo
     * contact ever reaches Meta.
     */
    isDemo: { type: Boolean, default: false },
    /**
     * A photo the workspace uploaded for this contact.
     *
     * Mirrors the User avatar fields exactly, including select:false — the
     * bytes live in Cloudinary and only the dedicated avatar route needs
     * the reference, so no ordinary contact query drags it along.
     *
     * Not fetched from WhatsApp: Meta's Cloud API exposes no way to read a
     * customer's profile picture, so this is the workspace's own record of
     * who someone is. avatarUpdatedAt is public and acts as a cache-buster
     * for the client's image URL.
     */
    avatarUrl: { type: String, select: false },
    avatarContentType: { type: String, select: false },
    avatarCloudinaryPublicId: { type: String, select: false },
    avatarUpdatedAt: { type: Date },
    tags: { type: [String], default: [] },
  },
  { timestamps: true },
);

// A phone number identifies one contact within a tenant.
// Same reasoning as the conversation index: one contact record per
// (tenant, owner, phone), so two users can each hold their own record for
// the same customer number. Also dropped-and-rebuilt by the backfill.
contactSchema.index({ tenantId: 1, ownerUserId: 1, phone: 1 }, { unique: true });
// Name-prefix search for the contacts screen's search box.
contactSchema.index({ tenantId: 1, name: 1 });
// Keyed on _id because that is what the list actually sorts and paginates
// by (`.sort({_id:-1})` with an `_id < cursor` range). The createdAt index
// this replaces matched the filter but not the sort, so every page loaded
// the whole matching set and sorted it in memory. ObjectId order is
// insertion order, so the rows come back in exactly the same sequence.
contactSchema.index({ tenantId: 1, _id: -1 });

type ContactAttrs = InferSchemaType<typeof contactSchema> & Timestamps;
export type ContactDoc = HydratedDocument<ContactAttrs>;
/** A `.lean()` row — see lib/modelTypes.ts. Structurally a superset-compatible
 *  match for ContactDoc, so serialisers accept either. */
export type ContactLean = Lean<ContactAttrs>;
export const Contact = model('Contact', contactSchema);
