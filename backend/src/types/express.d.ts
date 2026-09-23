import type { UserRole } from '../lib/jwt';
import type { Permission } from '../modules/users/permission';
import type { GuestContext } from '../modules/guest/guest.service';
import type { ConversationDoc } from '../modules/conversations/conversation.model';
import type { WhatsAppPhoneNumberDoc } from '../modules/whatsapp/whatsappPhoneNumber.model';

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: UserRole;
  permissions: Permission[];
  /**
   * The WhatsApp number this user was assigned, if any. Present here rather
   * than re-read per request because it decides which conversations the
   * user may see, and that question is asked on nearly every route.
   */
  whatsappPhoneNumberId?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by requireAuth. Never trust any tenantId from req.body/query — use this. */
      auth?: AuthContext;
      /**
       * Populated by requireGuest, for the customer-facing web chat only.
       * Separate from `auth` on purpose — a guest holds no user identity,
       * so no route that expects a logged-in user can be satisfied by one.
       */
      guest?: GuestContext;
      /**
       * The conversation requireVisibleConversation already proved this
       * caller may see. Present on every route under
       * /conversations/:conversationId so the handler does not pay a
       * second round trip for a document the guard has in hand.
       */
      visibleConversation?: ConversationDoc;
      /** Raw request body bytes, captured by express.json()'s `verify` hook in app.ts — needed for HMAC signature verification (Meta webhooks), which must hash the exact wire bytes. */
      rawBody?: Buffer;
      /**
       * Populated by requireLinkApiKey, for the public guest-link API an
       * external automation (WhatsApp Flows, a BSP chatbot) calls with its
       * own key instead of a user or guest session — see
       * guestLinkApi.routes.ts. The key names exactly one number, which is
       * also the tenant.
       */
      linkApiPhoneNumber?: WhatsAppPhoneNumberDoc;
    }
  }
}

export {};
