/**
 * What this platform will not send on a workspace's behalf.
 *
 * Narrowly aimed: commercial sexual services — escort advertising and the
 * booking flow around it. That is a prohibited use of the WhatsApp
 * Business Platform and of this platform, and the consequence when Meta
 * finds it is not a warning. It is the WABA disabled and every number on
 * it banned, at which point every OTHER workspace on the same business
 * account loses its numbers too, having done nothing.
 *
 * Applied to what the WORKSPACE sends, on every channel — WhatsApp and the
 * private web window alike. A filter that only covered WhatsApp would not
 * be a content policy, it would be a way of keeping the same activity
 * running where Meta cannot see it, which is both worse and, when found,
 * treated far more harshly than the original breach.
 *
 * NOT applied to what a customer sends. We do not control what a stranger
 * types, refusing it would delete the evidence an agent needs in order to
 * report or block them, and an inbound message has not left this platform
 * in anyone's name.
 *
 * Everything here is pure and heavily tested, because both failure
 * directions cost something real: a miss puts the whole business account
 * at risk, and a false positive silently stops a legitimate reply to a
 * customer who is waiting for it.
 */

/** What the agent is told. Names the category, so it is actionable rather than mysterious. */
export const CONTENT_POLICY_MESSAGE =
  'This message was not sent. It matches content this platform does not carry — ' +
  'advertising or arranging commercial sexual services. This is also a prohibited ' +
  'use of the WhatsApp Business Platform and puts every number on this account at risk.';

export const CONTENT_POLICY_CODE = 'CONTENT_POLICY_BLOCKED';

export interface PolicyViolation {
  /** 'EXPLICIT' matched on its own; 'CODED' needed a term from each group. */
  rule: 'EXPLICIT' | 'CODED';
  /** The canonical terms that matched, for the log. Never the message itself. */
  terms: string[];
}

/**
 * Terms that block on their own.
 *
 * The bar for this list is that a term has essentially no innocent use in
 * a business's reply to a customer. Anything with an ordinary meaning —
 * "payment", "booking", "service", "cash" — is deliberately NOT here: a
 * shop confirming an order and an escort advert use those words
 * identically, and blocking them would break the app for every legitimate
 * workspace while barely inconveniencing the one it is aimed at. Those
 * words are handled by the combination rule below.
 */
const EXPLICIT_TERMS = [
  'escort',
  'escorts',
  'escort service',
  'call girl',
  'callgirl',
  'call girls',
  'callgirls',
  'sex',
  'sexy',
  'sexual',
  'sexchat',
  'sex chat',
  'nude',
  'nudes',
  'prostitute',
  'prostitution',
  'hooker',
  'brothel',
  'whore',
  'gigolo',
  'incall',
  'outcall',
  'redlight',
  'red light area',
  'one night stand',
  // Hinglish, transliterated the way it is actually typed.
  'randi',
  'randee',
  'veshya',
  'vaishya',
  'kotha',
  'jism ka vyapar',
];

/**
 * Devanagari, matched as a plain substring of the raw lowercased text.
 *
 * Not because the normalizer would damage it — it strips the Latin
 * combining block (U+0300–U+036F), which leaves Devanagari matras
 * untouched — but because every piece of machinery below is Latin-shaped
 * and buys nothing here. Digit-for-letter substitution, letter-run
 * tolerance and `[a-z]` word boundaries all no-op against this script, so
 * the pattern builder would reduce to a substring test with extra steps.
 * This says that plainly instead.
 */
const EXPLICIT_TERMS_DEVANAGARI = [
  'रंडी',
  'वेश्या',
  'कॉल गर्ल',
  'कालगर्ल',
  'सेक्स',
  'कोठा',
  'वेश्यावृत्ति',
];

/**
 * Coded language, which only means anything in combination.
 *
 * Escort advertising avoids the explicit list above and reads instead as
 * an availability line plus a price-and-logistics line. Neither half is
 * incriminating alone: a courier writes "doorstep, cash payment", a salon
 * writes "body massage, per hour", and a recruiter writes "college girl
 * available". Requiring one term from EACH group is what separates those
 * from "housewife available, doorstep, cash only".
 *
 * Two groups rather than a simple threshold, and that is the whole point
 * of the design — a count of two would block the courier and the salon on
 * their own ordinary wording.
 */
const CODED_PERSON_TERMS = [
  'housewife',
  'house wife',
  'college girl',
  'collage girl',
  'college girls',
  'young girl',
  'young girls',
  'girls available',
  'girl available',
  'ladies available',
  'vip model',
  'vip models',
  'model available',
  'models available',
  'independent girl',
  'independent girls',
  'bhabhi',
  'aunty service',
];

const CODED_COMMERCE_TERMS = [
  'full service',
  'full night',
  'short time',
  'shortime',
  'unlimited shot',
  'unlimited shots',
  'doorstep',
  'door step',
  'no advance',
  'cash on delivery only',
  'cash payment',
  'cash only',
  'per hour rate',
  'night rate',
  'hotel room service',
  'home service available',
  'body massage',
  'satisfaction guaranteed',
  'real photo',
  'real pic',
  'genuine service',
];

/**
 * Separators an obfuscator puts BETWEEN letters, and nothing else.
 *
 * Exactly one, optional, and only these characters. A looser rule —
 * "any run of non-letters" — is how this kind of filter acquires false
 * positives that are very hard to see: with it, `s[^a-z]*e[^a-z]*x`
 * matches the phrase "sells exotic", because the regex is free to start
 * at the final s of "sells", swallow the space, and take the "ex" of
 * "exotic". The boundary rules below are what actually prevent that, and
 * keeping the separator to a single character keeps the margin wide.
 */
const SEPARATOR = String.raw`[.\-_*+\s]?`;

/**
 * Fold away the ways a term gets disguised, without folding away real words.
 *
 * Case, then diacritics, then the digit-for-letter substitutions. Padded
 * letters (`sexxxx`) are deliberately NOT collapsed here: collapsing
 * "call" to "cal" in the term list while "c-a-l-l" in the message has no
 * adjacent pair to collapse leaves the two unable to ever agree. Letter
 * runs are handled in the pattern instead, where a separator cannot hide
 * them.
 */
export function normalizeForPolicy(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    // Combining marks only. Mangles Devanagari, which is why those terms
    // are matched separately against the raw text.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0@]/g, (c) => (c === '@' ? 'a' : 'o'))
    .replace(/[1|!]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't');
}

/** A term, as a boundary-anchored, separator-tolerant pattern. */
function termPattern(term: string): RegExp {
  const normalized = normalizeForPolicy(term);
  const body = [...normalized]
    .map((ch) => {
      // A space in a term means "the words may be spaced, punctuated or
      // run together" — "call girl", "call-girl" and "callgirl" are one term.
      if (ch === ' ') return String.raw`[.\-_*+\s]*`;
      // `+` rather than a bare character: it absorbs the padding in
      // `sexxxx` and, because it backtracks, still matches the single
      // letters in `callgirl` where a greedy run would overshoot.
      return `${escapeRegExp(ch)}+${SEPARATOR}`;
    })
    .join('')
    // The trailing separator after the last character would let the
    // pattern end mid-word; the boundary below has to do that job.
    .replace(new RegExp(`${escapeRegExp(SEPARATOR)}$`), '');

  // Lookarounds rather than \b: \b treats the digits and underscores that
  // survive normalization as word characters inconsistently, and these
  // say exactly what is meant — not in the middle of a longer word. This
  // is what keeps "sex" out of "Essex" and "Sussex".
  return new RegExp(`(?<![a-z])${body}(?![a-z])`, 'i');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compiled once. These lists are constant for the process's lifetime. */
const EXPLICIT_PATTERNS = EXPLICIT_TERMS.map((term) => ({ term, pattern: termPattern(term) }));
const CODED_PERSON_PATTERNS = CODED_PERSON_TERMS.map((term) => ({ term, pattern: termPattern(term) }));
const CODED_COMMERCE_PATTERNS = CODED_COMMERCE_TERMS.map((term) => ({
  term,
  pattern: termPattern(term),
}));

function matches(
  haystack: string,
  patterns: { term: string; pattern: RegExp }[],
): string[] {
  return patterns.filter(({ pattern }) => pattern.test(haystack)).map(({ term }) => term);
}

/**
 * Whether this text may be sent on a workspace's behalf.
 *
 * Returns the matched terms so the refusal can be logged and the list
 * tuned. Returns null for anything with no text in it at all, which is
 * most sends — a sticker, an image with no caption, a location pin.
 */
export function findPolicyViolation(text: string | undefined | null): PolicyViolation | null {
  const raw = String(text ?? '');
  if (!raw.trim()) return null;

  const lowered = raw.toLowerCase();
  const devanagari = EXPLICIT_TERMS_DEVANAGARI.filter((term) => lowered.includes(term));
  if (devanagari.length > 0) return { rule: 'EXPLICIT', terms: devanagari };

  const normalized = normalizeForPolicy(raw);

  const explicit = matches(normalized, EXPLICIT_PATTERNS);
  if (explicit.length > 0) return { rule: 'EXPLICIT', terms: explicit };

  const person = matches(normalized, CODED_PERSON_PATTERNS);
  if (person.length === 0) return null;
  const commerce = matches(normalized, CODED_COMMERCE_PATTERNS);
  if (commerce.length === 0) return null;

  return { rule: 'CODED', terms: [...person, ...commerce] };
}

/**
 * Every piece of text a send carries.
 *
 * A caption and a location's label leave the platform exactly as a message
 * body does, so checking only `text` would leave the obvious way around
 * this open — put the advert in the caption of the photo it belongs to.
 */
export function findPolicyViolationInSend(input: {
  text?: string;
  caption?: string;
  filename?: string;
  location?: { name?: string; address?: string } | null;
}): PolicyViolation | null {
  const fields = [
    input.text,
    input.caption,
    input.filename,
    input.location?.name,
    input.location?.address,
  ];
  for (const field of fields) {
    const violation = findPolicyViolation(field);
    if (violation) return violation;
  }
  return null;
}
