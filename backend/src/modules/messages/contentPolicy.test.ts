import {
  findPolicyViolation,
  findPolicyViolationInSend,
  normalizeForPolicy,
} from './contentPolicy';

/**
 * Two failure directions, both expensive, so both are pinned here.
 *
 * A MISS lets the content out and risks the whole business account — every
 * number on the WABA, including other workspaces'. A FALSE POSITIVE
 * silently refuses a legitimate reply to a customer who is waiting for it,
 * and nobody finds out until they complain that nobody answered. The
 * "lets through" block is therefore not padding; it is the half of this
 * that is easy to get wrong and hard to notice.
 */
describe('findPolicyViolation', () => {
  const blocked = (text: string) => findPolicyViolation(text) !== null;

  describe('blocks explicit terms on their own', () => {
    it.each([
      'escort service available in your city',
      'Call girl available now',
      'callgirls ready',
      'we provide sex chat',
      'incall and outcall available',
      'randi available tonight',
      'gigolo job available',
      'brothel',
    ])('%s', (text) => {
      expect(blocked(text)).toBe(true);
    });

    it('reports which terms matched, for the log — never the message', () => {
      expect(findPolicyViolation('escort available')).toEqual({
        rule: 'EXPLICIT',
        terms: ['escort'],
      });
    });
  });

  describe('sees through the usual obfuscation', () => {
    it.each([
      ['spacing', 's e x'],
      ['dots', 's.e.x'],
      ['dashes', 'c-a-l-l g-i-r-l'],
      ['leetspeak', '3sc0rt s3rvice'],
      ['padded letters', 'sexxxx'],
      ['mixed case', 'EsCoRt'],
      ['run together', 'callgirl'],
      ['diacritics', 'éscört'],
    ])('%s: %s', (_label, text) => {
      expect(blocked(text)).toBe(true);
    });
  });

  it('reads Devanagari as well as Latin', () => {
    expect(blocked('रंडी उपलब्ध है')).toBe(true);
    expect(blocked('कॉल गर्ल')).toBe(true);
    expect(blocked('आपका ऑर्डर कल पहुँच जाएगा')).toBe(false);
  });

  it('leaves Devanagari alone when normalizing, so the raw pass can match it', () => {
    // The stripped range is the LATIN combining block, so matras survive.
    // If that ever changed, the terms above would silently stop matching.
    expect(normalizeForPolicy('रंडी')).toBe('रंडी');
  });

  describe('lets ordinary business messages through', () => {
    it.each([
      'Your booking is confirmed for tomorrow at 4pm.',
      'Payment received, thank you!',
      'We accept cash on delivery.',
      'Our service team will call you back shortly.',
      'Please book a slot using the link below.',
      'The cash payment option is available at doorstep.',
      'Doorstep delivery, cash only — is that okay?',
      'Body massage chair, 2 year warranty, per hour usage guide attached.',
      'A college girl applied for the receptionist role.',
      'Full service package for your car, genuine service centre.',
      'Room service is available till 11pm.',
      'Real photo of the product attached.',
    ])('%s', (text) => {
      expect(blocked(text)).toBe(false);
    });

    it('does not find a term inside a longer word', () => {
      // The classic false positive this filter has to survive.
      expect(blocked('Our Essex branch is open')).toBe(false);
      expect(blocked('Sussex office')).toBe(false);
      expect(blocked('He is a bookkeeper')).toBe(false);
    });

    it('does not let a separator-tolerant pattern span two real words', () => {
      // `s[^a-z]*e[^a-z]*x` would match this by starting at the last s of
      // "sells" and taking the "ex" of "exotic". The boundary rules are
      // what stop it, and this is the test that would catch them breaking.
      expect(blocked('She sells exotic plants')).toBe(false);
      expect(blocked('Bus exit is on the left')).toBe(false);
    });

    it('treats an empty or blank message as nothing to check', () => {
      expect(findPolicyViolation('')).toBeNull();
      expect(findPolicyViolation('   ')).toBeNull();
      expect(findPolicyViolation(undefined)).toBeNull();
      expect(findPolicyViolation(null)).toBeNull();
    });
  });

  describe('coded language, which only counts in combination', () => {
    it('blocks an availability line paired with a price-and-logistics line', () => {
      expect(blocked('housewife available, doorstep, cash only')).toBe(true);
      expect(blocked('vip models available — full night, no advance')).toBe(true);
      expect(findPolicyViolation('college girl available, short time')).toMatchObject({
        rule: 'CODED',
      });
    });

    it('needs one from EACH group, not merely two matches', () => {
      // A courier and a salon each hit two commerce terms on their own
      // ordinary wording. A plain count of two would block both of them.
      expect(blocked('Doorstep delivery and cash payment both available')).toBe(false);
      expect(blocked('Body massage, per hour rate, satisfaction guaranteed')).toBe(false);
      // …and a person term alone is an ordinary sentence.
      expect(blocked('A housewife and a college girl came to the demo')).toBe(false);
    });
  });
});

describe('findPolicyViolationInSend', () => {
  it('checks every field that leaves the platform, not just the body', () => {
    // Putting the advert in the caption of the photo it belongs to is the
    // obvious way around a body-only check.
    expect(findPolicyViolationInSend({ caption: 'escort service' })).not.toBeNull();
    expect(findPolicyViolationInSend({ filename: 'callgirl-rates.pdf' })).not.toBeNull();
    expect(findPolicyViolationInSend({ location: { name: 'Escorts hotel' } })).not.toBeNull();
    expect(findPolicyViolationInSend({ location: { address: 'red light area' } })).not.toBeNull();
  });

  it('passes an ordinary send with media and a caption', () => {
    expect(
      findPolicyViolationInSend({
        text: 'Here is your invoice',
        caption: 'Payment due Friday',
        filename: 'invoice-2231.pdf',
      }),
    ).toBeNull();
  });

  it('passes a send that carries no text at all', () => {
    expect(findPolicyViolationInSend({})).toBeNull();
  });
});
