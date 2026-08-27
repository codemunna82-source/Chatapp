import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const TEMPLATE_STATUSES = ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

// Meta's official template categories — do not invent additional ones.
export const TEMPLATE_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/**
 * Mirrors a template registered with Meta (created/approved via Meta's own
 * template manager — this backend does not fabricate templates). `components`
 * stores Meta's own component schema (header/body/footer/buttons) verbatim
 * so send requests can be built directly from it.
 */
const messageTemplateSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true },
    language: { type: String, required: true }, // e.g. "en_US"
    category: { type: String, enum: TEMPLATE_CATEGORIES, required: true },
    status: { type: String, enum: TEMPLATE_STATUSES, default: 'PENDING', required: true },
    components: { type: Schema.Types.Mixed, required: true },
    metaTemplateId: { type: String },
  },
  { timestamps: true },
);

messageTemplateSchema.index({ tenantId: 1, status: 1 });
messageTemplateSchema.index({ tenantId: 1, name: 1, language: 1 }, { unique: true });

export type MessageTemplateDoc = HydratedDocument<InferSchemaType<typeof messageTemplateSchema>>;
export const MessageTemplate = model('MessageTemplate', messageTemplateSchema);
