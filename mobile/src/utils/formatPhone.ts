/**
 * A phone number as a person would read it.
 *
 * Twelve unbroken digits are read one at a time or not at all, and the
 * chat header is where that hurts most: a customer with no saved name IS
 * their number there, so "+919876543210" leaves the header saying
 * nothing anyone can take in at a glance.
 *
 * Deliberately approximate, and the same rule the server uses for
 * notification titles (backend src/lib/phone.ts). Proper national
 * formatting is a country-by-country dataset — libphonenumber is ~250kB
 * of it — and this is a display nicety, not a dialling string: nothing is
 * stored, matched or sent anywhere in this form.
 *
 * A second copy of that rule rather than a shared one, because the two
 * run in different processes with no code path between them. They are
 * kept identical on purpose, and the tests either side say so.
 */
const DISPLAY_GROUPS: Record<string, number[]> = {
  '91': [5, 5], // India — 98765 43210
  '1': [3, 3, 4], // US/Canada — 415 555 0123
  '44': [4, 6], // UK — 7700 900123
  '971': [2, 3, 4], // UAE — 50 123 4567
};

export function formatPhoneForDisplay(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';

  // Only a canonical E.164 number is grouped. Anything else — an
  // extension, a name that found its way into a phone field — is handed
  // back untouched rather than cut up into blocks that mean nothing.
  if (!/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed;
  const digits = trimmed.slice(1);

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
  // digits — the ones people recognise a number by — together.
  const blocks: string[] = [];
  for (let end = digits.length; end > 0; end -= 4) {
    blocks.unshift(digits.slice(Math.max(0, end - 4), end));
  }
  return `+${blocks.join(' ')}`;
}

/** What to call a contact on screen: their name, or their number written
 *  so it can be read. */
export function contactDisplayName(
  contact: { name?: string | null; phone?: string | null } | null | undefined,
  fallback = 'Conversation',
): string {
  const name = contact?.name?.trim();
  if (name) return name;
  return formatPhoneForDisplay(contact?.phone) || fallback;
}
