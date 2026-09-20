import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { GUEST_DOMAIN_SOURCES } from './guestDomain';

export const TENANT_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

const tenantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    /**
     * The name customers see — in the web chat window's header and in its
     * push notifications.
     *
     * Separate from `name` on purpose. `name` is the workspace's internal
     * label: it is set once by the seed (default "Demo Tenant"), shown
     * only to staff, and renaming it is an admin action with its own
     * consequences. This is the public-facing one, and the only name a
     * stranger who taps the invitation link will ever read.
     *
     * Optional, and normally left unset: the best answer is the display
     * name Meta already holds for the number the customer messaged, which
     * is the name they saw in WhatsApp a moment earlier. This exists for
     * the workspace that wants to override that — a trading name, a
     * department — and for the gap before Meta has approved a name at
     * all. See resolveGuestBusinessName() in guest.service.ts for the
     * order the two are tried in.
     */
    displayName: { type: String, trim: true, maxlength: 120 },
    /**
     * The workspace's photo, as a customer sees it at the top of the web
     * chat window.
     *
     * Mirrors the User and Contact avatar fields exactly, including
     * select:false — the bytes live in Cloudinary and only the routes
     * that serve them need the reference. avatarUpdatedAt is public and
     * is the cache-buster every client keys its copy on.
     *
     * A workspace photo rather than the answering member's own, and that
     * is the whole reason it exists here: the customer-facing NAME
     * already falls back to a member's (see businessName.ts), but a
     * person's photograph is a different kind of thing to hand to a
     * stranger than the name they chose to trade under. This is set
     * deliberately, by an admin, or there is none.
     */
    avatarUrl: { type: String, select: false },
    avatarContentType: { type: String, select: false },
    avatarCloudinaryPublicId: { type: String, select: false },
    avatarUpdatedAt: { type: Date },
    slug: { type: String, required: true, trim: true, lowercase: true },
    /**
     * What may be said over WhatsApp before the customer opens their
     * private chat, and how many times.
     *
     * `enforced` on means an agent can send only these, in this order,
     * and nothing else — see nudgeTemplates.ts for why that is stricter
     * than a simple count. The number of messages IS the allowance: two
     * entries means two WhatsApp messages, then the private link is the
     * only way through.
     *
     * `messages` unset means the defaults, not "none". A workspace that
     * has never opened this screen and one that deliberately wants no
     * restriction are different things, and the second is said with the
     * switch.
     */
    whatsappNudges: {
      enforced: { type: Boolean, default: true },
      messages: { type: [String], default: undefined },
    },
    /**
     * The domain this workspace's private-chat links are built on.
     *
     * Unset means the shared GUEST_LINK_BASE_URL, which is where every
     * workspace starts and where most stay. It is set when a workspace
     * needs its link reputation separated from everyone else's — see
     * guestDomain.ts for why a subdomain would not achieve that.
     *
     * `host` is a bare hostname, always served over https. `source` says
     * who owns it: POOL is one of ours, handed out automatically, and is
     * usable the moment it is assigned. CUSTOM is the workspace's own and
     * is NOT usable until `verifiedAt` is set — until then we would be
     * pointing customers at a hostname nobody has proved they control.
     *
     * `verifyToken` is the value that has to appear in their DNS. Kept on
     * the document rather than derived, so re-reading the settings screen
     * shows the same record they were told to create rather than a new
     * one every time.
     */
    guestDomain: {
      host: { type: String, trim: true, lowercase: true },
      source: { type: String, enum: GUEST_DOMAIN_SOURCES },
      verifyToken: { type: String },
      verifiedAt: { type: Date },
      /** When a POOL host was handed out, or a CUSTOM one was claimed. */
      assignedAt: { type: Date },
    },
    status: { type: String, enum: TENANT_STATUSES, default: 'ACTIVE', required: true },
    masterAdminId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

tenantSchema.index({ slug: 1 }, { unique: true });

/**
 * One workspace per hostname, enforced by the database rather than by the
 * route that sets it.
 *
 * Two workspaces on one host is not a cosmetic clash: the host decides
 * which origin the API trusts and which workspace a customer's link is
 * read against, so a duplicate would let one workspace's domain carry
 * another's chat sessions. Sparse, because the overwhelming majority of
 * documents have no host at all and a plain unique index would let exactly
 * one of them exist.
 */
tenantSchema.index(
  { 'guestDomain.host': 1 },
  { unique: true, partialFilterExpression: { 'guestDomain.host': { $type: 'string' } } },
);

export type TenantDoc = HydratedDocument<InferSchemaType<typeof tenantSchema>>;
export const Tenant = model('Tenant', tenantSchema);
