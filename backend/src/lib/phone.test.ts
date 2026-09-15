import {
  contactDisplayName,
  formatPhoneForDisplay,
  normalizePhone,
  phoneVariants,
  toWhatsAppId,
} from './phone';

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

describe('toWhatsAppId', () => {
  it('sends digits back in the form Meta itself uses', () => {
    // messages[].from on a Cloud API webhook is bare digits, so this is
    // the one representation guaranteed to address the same person.
    expect(toWhatsAppId('+919876543210')).toBe('919876543210');
    expect(toWhatsAppId('919876543210')).toBe('919876543210');
  });

  it('strips the punctuation an agent typed before it reaches the wire', () => {
    expect(toWhatsAppId('+91 98765-43210')).toBe('919876543210');
    expect(toWhatsAppId('00919876543210')).toBe('919876543210');
  });

  it('passes through a value it cannot parse rather than mangling it', () => {
    // Refusing to send is worse than sending what is stored: the number
    // may be one Meta accepts and this parser does not know about.
    expect(toWhatsAppId('weird-id')).toBe('weird-id');
  });

  it('never leaves a plus on the wire', () => {
    // The regression this exists to prevent: contacts are stored
    // canonically, so sending the stored string verbatim would put a `+`
    // in front of every outbound message once the merge canonicalises
    // the older rows.
    for (const input of ['+919876543210', '00919876543210', '+1 (415) 555-1234']) {
      expect(toWhatsAppId(input).startsWith('+')).toBe(false);
    }
  });
});

/**
 * What a notification calls a customer who has no saved name. This is the
 * first thing an agent reads on a ringing phone, so the only real
 * requirement is that it can be read at all — and that it never comes out
 * empty, because a nameless notification is one nobody answers.
 */
describe('formatPhoneForDisplay', () => {
  it('groups an Indian number the way an Indian number is written', () => {
    expect(formatPhoneForDisplay('+919876543210')).toBe('+91 98765 43210');
  });

  it('groups a US number the way a US number is written', () => {
    expect(formatPhoneForDisplay('+14155550123')).toBe('+1 415 555 0123');
  });

  it('does not let +1 swallow a number that is really +971', () => {
    expect(formatPhoneForDisplay('+971501234567')).toBe('+971 50 123 4567');
  });

  it('still breaks up a country it has no pattern for', () => {
    // Spain: no entry in the table, so even blocks rather than a wall of
    // digits. Readable is the whole bar here, not correct national format.
    expect(formatPhoneForDisplay('+34612345678')).toBe('+346 1234 5678');
  });

  it('falls back to even blocks when the length does not match the pattern', () => {
    // A +91 number with the wrong digit count is not an Indian mobile, and
    // forcing 5+5 onto it would invent digits or drop them.
    expect(formatPhoneForDisplay('+911234567')).toBe('+9 1123 4567');
  });

  it('returns null for nothing at all', () => {
    expect(formatPhoneForDisplay(undefined)).toBeNull();
    expect(formatPhoneForDisplay('')).toBeNull();
  });

  it('hands back an unparseable string rather than losing it', () => {
    // Better a strange notification title than a blank one.
    expect(formatPhoneForDisplay('extension 4021')).toBe('extension 4021');
  });
});

describe('contactDisplayName', () => {
  it('prefers the saved name', () => {
    expect(contactDisplayName({ name: 'Priya Sharma', phone: '+919876543210' })).toBe('Priya Sharma');
  });

  it('ignores a name that is only whitespace', () => {
    expect(contactDisplayName({ name: '   ', phone: '+919876543210' })).toBe('+91 98765 43210');
  });

  it('falls back for a web guest with neither', () => {
    expect(contactDisplayName(null)).toBe('Web chat');
    expect(contactDisplayName({}, 'Unknown caller')).toBe('Unknown caller');
  });
});
