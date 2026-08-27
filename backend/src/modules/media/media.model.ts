import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const MEDIA_STATUSES = ['UPLOADING', 'READY', 'FAILED'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

const mediaSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    metaMediaId: { type: String }, // Meta's media id, once uploaded to Graph API
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    sha256: { type: String, required: true },
    storageRef: { type: String, required: true }, // our own object storage key/URL
    status: { type: String, enum: MEDIA_STATUSES, default: 'UPLOADING', required: true },
  },
  { timestamps: true },
);

mediaSchema.index({ tenantId: 1, createdAt: -1 });
mediaSchema.index({ metaMediaId: 1 }, { sparse: true });
// Dedupe identical files re-uploaded within a tenant.
mediaSchema.index({ tenantId: 1, sha256: 1 });

export type MediaDoc = HydratedDocument<InferSchemaType<typeof mediaSchema>>;
export const Media = model('Media', mediaSchema);
