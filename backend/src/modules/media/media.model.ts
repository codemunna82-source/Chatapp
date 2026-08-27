import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const MEDIA_STATUSES = ['UPLOADING', 'READY', 'FAILED'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

const mediaSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    // Which WhatsApp connection's credentials to use when retrieving this
    // file's bytes from Meta (spec's media-proxy design — see media.service.ts
    // streamMediaForTenant) — a tenant can hold multiple WhatsApp accounts.
    whatsappPhoneNumberId: { type: Schema.Types.ObjectId, ref: 'WhatsAppPhoneNumber', required: true },
    metaMediaId: { type: String }, // Meta's media id, once uploaded to Graph API
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    sha256: { type: String, required: true },
    // Our own object-storage cache of this file's bytes: `pending:<sha256>`
    // until cached, `meta:<metaMediaId>` for inbound media not yet cached,
    // or a real https:// Cloudinary URL once cached (see integrations/cloudinary.ts
    // and media.service.ts's cache-on-read / cache-on-upload logic).
    storageRef: { type: String, required: true },
    // Only set once storageRef holds a real Cloudinary URL — needed to
    // delete/manage the asset later.
    cloudinaryPublicId: { type: String },
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
