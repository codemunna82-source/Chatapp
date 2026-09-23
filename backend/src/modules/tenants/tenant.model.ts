import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { GUEST_DOMAIN_SOURCES } from './guestDomain';

export const TENANT_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

/**
 * One workspace-facing invitation configuration.
 *
 * Used both as the tenant-wide default (`Tenant.autoGuestLink`) and, keyed
 * by Business Manager, in `Tenant.autoGuestLinkByApp` — extracted so the
 * two cannot drift into two different shapes of the same setting.
 */
const autoGuestLinkSchema = new Schema(
  {
    enabled: { type: Boolean, default: false, required: true },
    /**
     * How the invitation is sent.
     *
     * 'text' is the default and needs nothing from Meta: the reply
     * goes out as an ordinary message with the link in it. That
     * works because this only ever fires in direct response to a
     * customer's own message, so Meta's 24-hour window is open by
     * definition — the one moment free-form text is allowed.
     *
     * 'template' sends an approved template instead, which is the
     * upgrade: Meta renders its URL button as a real tappable
     * control rather than a bare link. Worth having, but it costs a
     * review cycle, and a workspace should not have to wait on Meta
     * to get its first customer into the chat window.
     */
    mode: { type: String, enum: ['text', 'template'], default: 'text', required: true },
    /** The text sent in 'text' mode. {{link}} becomes the customer's own URL. */
    message: { type: String, trim: true, maxlength: 900 },
    /** The approved template's name, exactly as it appears in WhatsApp Manager. */
    templateName: { type: String, trim: true, maxlength: 512 },
    /** Meta's language code for the approved copy, e.g. "en" or "en_US". */
    templateLanguage: { type: String, trim: true, maxlength: 16 },
    /**
     * What fills the template body's {{1}}, when it has one.
     *
     * 'none' for a body with no variables. Sending a parameter to a
     * template that takes none makes Meta reject the whole send, and
     * omitting one it needs does the same — so this has to be stated
     * rather than guessed.
     */
    bodyVariable: {
      type: String,
      enum: ['none', 'customer_name'],
      default: 'none',
    },
    /**
     * How many times the invitation may be sent to one customer.
     *
     * Default 1. Two is the useful setting and the reason this is a
     * number at all: a customer who writes again without tapping the
     * link almost certainly did not see it. Capped at 3, because
     * past that the customer is not missing the message — they are
     * declining it, and a fourth is just noise from a business that
     * will not take an answer.
     */
    maxSends: { type: Number, default: 1, min: 1, max: 3 },
    /**
     * Hold WhatsApp messages out of the inbox until the customer
     * moves to the web window.
     *
     * Off by default, and it should be turned on deliberately: it
     * means a customer who never taps the link is never seen. They
     * are not LOST — every message is stored and appears the moment
     * they arrive — but nobody is looking at them in the meantime.
     */
    holdWhatsAppUntilOpened: { type: Boolean, default: false, required: true },
    /**
     * Greeting posted into the conversation the first time the
     * customer opens the window.
     *
     * A real message in the thread, not a UI banner: the agent sees
     * it too, so what the customer was told is part of the history
     * rather than something only one side knows.
     */
    welcomeMessage: { type: String, trim: true, maxlength: 900 },
  },
  { _id: false },
);

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
    /**
     * Automatically hand a customer the private-chat link the moment they
     * message this workspace's WhatsApp number.
     *
     * Off by default, and that is not timidity: turning it on changes what
     * every customer of this workspace receives, unprompted, on their own
     * phone. That is an owner's decision, not a default someone discovers
     * after it has already gone out a hundred times.
     *
     * Sent as an APPROVED WHATSAPP TEMPLATE, not as text this server
     * composes. Meta renders a template's URL button as a real tappable
     * control with the address hidden behind a label, which is what makes
     * a stranger willing to tap it — free-form text can only carry a bare
     * link. It also means the wording lives in WhatsApp Manager, where it
     * has been reviewed, rather than in a field here that could send
     * anything.
     *
     * The template's button URL must be configured in WhatsApp Manager
     * with a dynamic suffix — `https://your-app/c/{{1}}` — because that is
     * the only part of a template URL Meta lets a send vary. The session
     * token goes into that one variable; see guestAutoReply.service.ts.
     */
    autoGuestLink: {
      type: autoGuestLinkSchema,
      default: () => ({ enabled: false, bodyVariable: 'none' }),
    },
    /**
     * The SAME invitation, configured separately per Business Manager.
     *
     * autoGuestLink above is a single, tenant-wide setting, and a template
     * lives on one Business Manager's WhatsApp Business Account — Meta
     * rejects a send naming a template that was approved on a different
     * one (#132001). A workspace with only one Business Manager never
     * notices; one with several has every number past the first silently
     * sending nothing, because the one template name in `autoGuestLink`
     * cannot be right for two different WABAs at once.
     *
     * Keyed by MetaApp _id as a string (Mongoose Map keys are always
     * strings). Deliberately additive rather than a replacement: a number
     * with no entry here — including every number on a workspace that has
     * never opened the per-Business-Manager picker — keeps using
     * `autoGuestLink` exactly as before. See resolveAutoGuestLinkConfig()
     * in guestAutoReply.service.ts for the lookup this enables.
     */
    autoGuestLinkByApp: {
      type: Map,
      of: autoGuestLinkSchema,
      default: () => new Map(),
    },
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

/**
 * The index of a template's URL button, as a string, for the send payload.
 *
 * Always "0": Meta numbers button components by their position among the
 * template's buttons, and the invitation template has exactly one. Named
 * rather than inlined so the assumption is visible at the call site, where
 * a template with a second button would need it changed.
 */
export const AUTO_GUEST_LINK_BUTTON_INDEX = '0';

/**
 * What a customer is sent when nobody has written their own wording.
 *
 * Two short lines and the link on its own. WhatsApp renders a URL on its
 * own line as a tappable preview, which a link buried mid-sentence does
 * not get — and the emoji are load-bearing rather than decoration: this
 * arrives unprompted from a business, and a wall of plain text from an
 * unknown number is what people scroll past.
 */
export const DEFAULT_AUTO_GUEST_LINK_TEXT =
  '\u{1F4AC} Continue our conversation privately.\n\n\u{1F512} Open the private chat here:\n{{link}}';

/** The greeting shown when the customer first writes from the window. */
export const DEFAULT_AUTO_GUEST_WELCOME = 'Hello, welcome! How can we help you today?';

/**
 * The invitation text with the customer's own link in it.
 *
 * A template without {{link}} gets the URL appended on its own line
 * rather than sent as-is. An invitation with no link in it is the one
 * outcome that makes the whole feature pointless, and it would send
 * perfectly — nothing downstream would ever flag it.
 */
export function renderAutoGuestLinkText(template: string | undefined, url: string): string {
  const text = (template ?? DEFAULT_AUTO_GUEST_LINK_TEXT).trim();
  if (text.includes('{{link}}')) return text.replaceAll('{{link}}', url);
  return `${text}\n${url}`;
}

export type TenantDoc = HydratedDocument<InferSchemaType<typeof tenantSchema>>;
export const Tenant = model('Tenant', tenantSchema);
