import { normalizePhone, phoneVariants } from './phone';

/**
 * No database: this is the rule that decides whether a customer's web-chat
 * messages land in the same thread as their WhatsApp ones. Getting it
 * wrong does not fail anywhere — it quietly produces a second contact.
 */
describe('normalizePhone', () => {
  it('leaves an already-canonical number alone', () => {
    expect(normalizePhone('+919876543210')).toBe('+919876543210');
  });

  it('adds the + Meta omits', () => {
    // messages[].from on a Cloud API webhook is bare digits. This single
    // difference is what split one customer into two contacts.
    expect(normalizePhone('919876543210')).toBe('+919876543210');
  });

  it('treats a 00 prefix as +', () => {
    expect(normalizePhone('00919876543210')).toBe('+919876543210');
  });

  it('strips the punctuation people actually type', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('+919876543210');
    expect(normalizePhone('+1 (415) 555.1234')).toBe('+14155551234');
  });

  it('rejects what is not a phone number', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('not a number')).toBeNull();
    // Too short to be a real international number.
    expect(normalizePhone('12345')).toBeNull();
    // A leading zero after the + is not a valid country code.
    expect(normalizePhone('+0919876543210')).toBeNull();
  });
});

describe('phoneVariants', () => {
  it('matches both the canonical form and the bare digits already stored', () => {
    expect(phoneVariants('+919876543210')).toEqual(['+919876543210', '919876543210']);
    expect(phoneVariants('919876543210')).toEqual(['+919876543210', '919876543210']);
  });

  it('falls back to the raw value rather than matching nothing', () => {
    // An unparseable value should still look itself up: refusing to search
    // would hide a row that genuinely exists under that exact string.
    expect(phoneVariants('weird-id')).toEqual(['weird-id']);
    expect(phoneVariants('')).toEqual([]);
  });
});
