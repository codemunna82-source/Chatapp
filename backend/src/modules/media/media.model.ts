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
    sizeBytes: { type: Number, required: true, default: 0 },
    /**
     * The file's hash — present for media WE uploaded, absent for media a
     * customer sent.
     *
     * NOT required, and that is the whole point. Inbound WhatsApp media is
     * recorded at webhook time without ever downloading the bytes (see
     * webhook.service.ts — retrieval is deferred to the media proxy), so
     * there is nothing to hash yet. Requiring it made Mongoose reject every
     * inbound photo, video and voice note with "Path `sha256` is required",
     * which threw out of the webhook handler: the message was never stored,
     * Meta retried the delivery forever, and to the agent the customer's
     * image simply never arrived. An empty string does not satisfy
     * `required` on a String, so passing '' was the same as passing nothing.
     */
    sha256: { type: String },
    // Our own object-storage cache of this file's bytes: `pending:<sha256>`
    // until cached, `meta:<metaMediaId>` for inbound media not yet cached,
    // or a real https:// Cloudinary URL once cached (see integrations/cloudinary.ts
    // and media.service.ts's cache-on-read / cache-on-upload logic).
    storageRef: { type: String, required: true },
    // Only set once storageRef holds a real Cloudinary URL — needed to
    // delete/manage the asset later.
    cloudinaryPublicId: { type: String },
    /**
     * The file itself, for media that has nowhere else to live.
     *
     * Everything from WhatsApp is fetched back from Meta, and everything
     * cached goes to Cloudinary — but an image a customer sends in the web
     * chat never touches either: it is not going to WhatsApp, and
     * Cloudinary is optional configuration. Rather than making image
     * sending depend on a second service being set up, small files fall
     * back to the database.
     *
     * select:false so no ordinary media query drags a few megabytes of
     * image along; only the byte-serving path asks for it. Bounded by the
     * guest upload limit well under Mongo's 16MB document ceiling.
     */
    bytes: { type: Buffer, select: false },
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
