import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

const contactSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    phone: { type: String, required: true, trim: true }, // E.164, e.g. +14155551234
    name: { type: String, trim: true },
    avatarUrl: { type: String },
    tags: { type: [String], default: [] },
  },
  { timestamps: true },
);

// A phone number identifies one contact within a tenant.
contactSchema.index({ tenantId: 1, phone: 1 }, { unique: true });
// Name-prefix search for the contacts screen's search box.
contactSchema.index({ tenantId: 1, name: 1 });
contactSchema.index({ tenantId: 1, createdAt: -1 });

export type ContactDoc = HydratedDocument<InferSchemaType<typeof contactSchema>>;
export const Contact = model('Contact', contactSchema);
