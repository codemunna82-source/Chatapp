/**
 * One canonical shape for a customer's phone number.
 *
 * This exists because the two ways a contact gets created disagreed. The
 * REST API validates E.164 with a leading `+` (contact.validation.ts),
 * while Meta's webhook delivers `messages[].from` as bare digits with no
 * `+` at all. Stored verbatim, the same person becomes "+919876543210"
 * from one path and "919876543210" from the other — and since the unique
 * index is on the exact string, that is two contacts, two conversations,
 * and a customer whose web-chat messages land in a different thread from
 * their WhatsApp ones.
 */

/** The canonical form: `+` followed by digits. Returns null for anything that is not a plausible number. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // Spaces, dashes, dots, brackets: all routine in a number someone typed
  // or pasted, none of them meaningful.
  let cleaned = String(raw).replace(/[\s\-().]/g, '');

  // 00 is the other international prefix in common use; it means the same
  // thing as + and is what a phone's own dialler often stores.
  if (cleaned.startsWith('00')) cleaned = `+${cleaned.slice(2)}`;
  else if (!cleaned.startsWith('+')) cleaned = `+${cleaned}`;

  return /^\+[1-9]\d{7,14}$/.test(cleaned) ? cleaned : null;
}

/**
 * Every stored form the same number might already be under.
 *
 * Deployments that predate normalisation hold rows written straight from
 * Meta's webhook, so a lookup has to match those too — rewriting them all
 * would be a migration, and one that runs while messages are arriving.
 * Newly created rows always use the canonical form, so the split closes
 * over time instead of being reopened on every inbound message.
 */
export function phoneVariants(raw: string | null | undefined): string[] {
  const canonical = normalizePhone(raw);
  if (!canonical) return raw ? [String(raw)] : [];
  return [canonical, canonical.slice(1)];
}

/**
 * The form WhatsApp itself uses: digits, no leading `+`.
 *
 * This is what Meta sends as `messages[].from` for the very same customer,
 * so sending it back is the one representation guaranteed to address the
 * person the webhook was about. It is also already the convention at this
 * boundary — placing a call built `wa.me/<digits>` by stripping the plus
 * by hand — and having one function say so keeps the two from drifting.
 *
 * Storage stays canonical `+E.164`: that is what people read, and what
 * makes one customer one contact. Only the wire to Meta uses this.
 */
export function toWhatsAppId(phone: string): string {
  return (normalizePhone(phone) ?? phone).replace(/^\+/, '');
}
