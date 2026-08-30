import type { AuthContext } from '../../types/express';

/**
 * Which conversations this user may see, expressed as a WhatsApp number id
 * or `undefined` for "all of the tenant's".
 *
 * Three cases, and the third is the one that matters for anyone upgrading:
 *
 * - MASTER_ADMIN sees everything. They create the assignments and answer
 *   for the workspace; hiding half the inbox from the person managing it
 *   would make the feature unusable.
 * - A SUB_USER with an assigned number sees only that number's chats. This
 *   is the actual isolation: their colleague's customers are not theirs.
 * - A SUB_USER with *no* assignment sees everything, exactly as before this
 *   existed. Every user in every existing deployment is in this state, and
 *   the alternative — defaulting to "sees nothing" — would empty their
 *   inbox on deploy.
 *
 * So isolation is opt-in per user, and the act of assigning a number is
 * what turns it on for them.
 */
export function visibleWhatsAppPhoneNumberId(auth: AuthContext): string | undefined {
  if (auth.role === 'MASTER_ADMIN') return undefined;
  // Normalised rather than returned as-is: an empty string is falsy, so
  // every current caller already treats it as unscoped, but a future one
  // checking `!== undefined` would turn it into a filter matching no
  // conversation at all — an inbox that silently shows nothing.
  return auth.whatsappPhoneNumberId ? auth.whatsappPhoneNumberId : undefined;
}
