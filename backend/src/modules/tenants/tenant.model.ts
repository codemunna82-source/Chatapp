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
      type: new Schema(
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
      ),
      default: () => ({ enabled: false, bodyVariable: 'none' }),
    },
  },
  { timestamps: true },
);

tenantSchema.index({ slug: 1 }, { unique: true });

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
