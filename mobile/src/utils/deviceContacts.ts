import * as Contacts from 'expo-contacts';

export type SaveToPhoneResult = 'saved' | 'already-there' | 'permission-denied' | 'failed';

/** Everything that isn't a digit — spaces, dashes, brackets, a leading plus. */
function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Whether two phone numbers are the same person's.
 *
 * Compared on digits with one ending in the other rather than on exact
 * equality, because the same line is written a dozen ways across an
 * address book: `+91 98765 43210`, `098765 43210`, `9876543210`. Requiring
 * at least 7 matching digits keeps short codes and extensions from
 * collapsing into each other.
 */
function isSameNumber(a: string, b: string): boolean {
  const x = digitsOnly(a);
  const y = digitsOnly(b);
  if (x.length < 7 || y.length < 7) return false;
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  return longer.endsWith(shorter);
}

/**
 * Saves a VOXO contact into the phone's own address book, so a number added
 * here is recognised by the dialler, by WhatsApp itself, and by everything
 * else on the device.
 *
 * Never creates a duplicate: the address book is scanned for the same
 * number first. That scan reads every contact — expo-contacts offers no
 * query-by-number — which is why this runs on an explicit save rather than,
 * say, on every list render.
 *
 * Returns a result instead of throwing. A refused permission is a normal
 * outcome here, not an error: the app has no business insisting on write
 * access to someone's address book, and everything else about the contact
 * still works without it.
 */
export async function saveContactToPhone(input: { name?: string; phone: string }): Promise<SaveToPhoneResult> {
  const phone = input.phone.trim();
  if (!phone) return 'failed';

  try {
    const permission = await Contacts.requestPermissionsAsync();
    if (!permission.granted) return 'permission-denied';

    const existing = await Contacts.Contact.getAllDetails([Contacts.ContactField.PHONES]);
    const duplicate = existing.some((contact) =>
      (contact.phones ?? []).some((entry) => (entry.number ? isSameNumber(entry.number, phone) : false)),
    );
    if (duplicate) return 'already-there';

    await Contacts.Contact.create({
      // Falling back to the number itself keeps the entry findable; a
      // nameless address-book row shows as blank on most Android diallers.
      givenName: input.name?.trim() || phone,
      phones: [{ label: 'mobile', number: phone }],
    });
    return 'saved';
  } catch {
    return 'failed';
  }
}

/** Human-readable outcome, for the one line of feedback the UI shows after a save. */
export function describeSaveResult(result: SaveToPhoneResult): string {
  switch (result) {
    case 'saved':
      return 'Saved to your phone contacts.';
    case 'already-there':
      return 'Already in your phone contacts.';
    case 'permission-denied':
      return 'Contacts permission denied — not saved to your phone.';
    case 'failed':
      return 'Could not save to your phone contacts.';
  }
}
