import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const TENANT_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

const tenantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    status: { type: String, enum: TENANT_STATUSES, default: 'ACTIVE', required: true },
    masterAdminId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

tenantSchema.index({ slug: 1 }, { unique: true });

export type TenantDoc = HydratedDocument<InferSchemaType<typeof tenantSchema>>;
export const Tenant = model('Tenant', tenantSchema);
