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

/**
 * A phone number as a person would read it, for the places a name is
 * expected but none was saved.
 *
 * A notification title is the one place `+919876543210` really hurts: it
 * is the first thing an agent sees on a ringing phone, and twelve
 * unbroken digits are read one at a time or not at all. Grouped, the same
 * number is recognised at a glance.
 *
 * Deliberately approximate. Proper national formatting is a country-by-
 * country dataset — libphonenumber is ~250kB of it — and this is a
 * display nicety, not a validation or a dialling string: nothing is ever
 * stored, matched or sent to Meta in this form. So the four codes this
 * deployment actually serves get their real grouping, and everything else
 * gets even blocks, which is still far easier to read than none. Storage
 * and lookup stay on `normalizePhone`.
 */
const DISPLAY_GROUPS: Record<string, number[]> = {
  '91': [5, 5], // India — 98765 43210
  '1': [3, 3, 4], // US/Canada — 415 555 0123
  '44': [4, 6], // UK — 7700 900123
  '971': [2, 3, 4], // UAE — 50 123 4567
};

export function formatPhoneForDisplay(raw: string | null | undefined): string | null {
  const canonical = normalizePhone(raw);
  if (!canonical) return raw ? String(raw).trim() || null : null;

  const digits = canonical.slice(1);

  // Longest code first, so +1 never claims a number that is really +971.
  for (const code of Object.keys(DISPLAY_GROUPS).sort((a, b) => b.length - a.length)) {
    if (!digits.startsWith(code)) continue;
    const rest = digits.slice(code.length);
    const groups = DISPLAY_GROUPS[code] ?? [];
    if (rest.length !== groups.reduce((sum, n) => sum + n, 0)) break; // Not the length this pattern is for.
    const parts: string[] = [];
    let at = 0;
    for (const size of groups) {
      parts.push(rest.slice(at, at + size));
      at += size;
    }
    return `+${code} ${parts.join(' ')}`;
  }

  // Unknown country: blocks of four from the right, which keeps the last
  // digits — the ones people actually recognise a number by — together.
  const blocks: string[] = [];
  for (let end = digits.length; end > 0; end -= 4) {
    blocks.unshift(digits.slice(Math.max(0, end - 4), end));
  }
  return `+${blocks.join(' ')}`;
}

/**
 * What to call a contact on screen: their name, or their number written
 * so it can be read, or a last resort.
 *
 * One function because six call sites had each written
 * `contact?.name || contact?.phone || 'Web chat'` by hand, and a push
 * title that disagrees with the conversation header about who a person is
 * is the kind of difference nobody notices until a customer is on the
 * phone.
 */
export function contactDisplayName(
  contact: { name?: string | null; phone?: string | null } | null | undefined,
  fallback = 'Web chat',
): string {
  const name = contact?.name?.trim();
  if (name) return name;
  return formatPhoneForDisplay(contact?.phone) ?? fallback;
}
