import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const TENANT_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

const tenantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    status: { type: String, enum: TENANT_STATUSES, default: 'ACTIVE', required: true },
    masterAdminId: { type: Schema.Types.ObjectId, ref: 'User' },
    /**
     * Automatically hand a customer the private-chat link the moment they
     * message this workspace's WhatsApp number.
     *
     * Off by default, and that is not timidity: turning it on changes what
     * every customer of this workspace receives, unprompted, on their own
     * phone. That is an owner's decision, not a default someone discovers
     * after it has already gone out a hundred times.
     *
     * `message` is the text sent, with {{link}} standing in for the URL.
     * Stored per tenant rather than hard-coded because the wording is the
     * business's voice, and because a customer who is asked to tap an
     * unfamiliar link deserves to be told why in that business's own words.
     */
    autoGuestLink: {
      type: new Schema(
        {
          enabled: { type: Boolean, default: false, required: true },
          message: { type: String, trim: true, maxlength: 900 },
        },
        { _id: false },
      ),
      default: () => ({ enabled: false }),
    },
  },
  { timestamps: true },
);

tenantSchema.index({ slug: 1 }, { unique: true });

/**
 * What a customer is sent when nobody has written their own wording.
 *
 * {{link}} is substituted at send time. Kept beside the schema so the
 * default is one string rather than one per caller — the API, the admin
 * form and the sender all need to agree on it.
 */
export const DEFAULT_AUTO_GUEST_LINK_MESSAGE =
  'Continue this conversation privately in our secure chat window:\n{{link}}';

/** Substitutes {{link}}, appending the URL if the wording left it out. */
export function renderAutoGuestLinkMessage(template: string | undefined, url: string): string {
  const text = (template ?? DEFAULT_AUTO_GUEST_LINK_MESSAGE).trim();
  if (text.includes('{{link}}')) return text.replaceAll('{{link}}', url);
  // A message without the placeholder would otherwise be sent with no link
  // in it at all — the one outcome that makes the whole feature pointless.
  return `${text}\n${url}`;
}

export type TenantDoc = HydratedDocument<InferSchemaType<typeof tenantSchema>>;
export const Tenant = model('Tenant', tenantSchema);
