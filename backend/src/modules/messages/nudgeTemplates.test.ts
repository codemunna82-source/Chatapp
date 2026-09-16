import {
  DEFAULT_WHATSAPP_NUDGES,
  nudgeAt,
  nudgesFor,
  sameNudgeText,
} from './nudgeTemplates';
import { nudgesLeft, nudgeQuotaMessage, WHATSAPP_NUDGE_LIMIT } from './whatsappQuota';

/**
 * The fixed WhatsApp wording, and the sequence it goes out in.
 *
 * Worth pinning because the failure is silent in both directions. Too
 * loose and an agent can say anything to a customer who never engaged,
 * which is what costs a business account. Too strict and a legitimate
 * send is refused over a trailing newline nobody can see.
 */
describe('nudgesFor', () => {
  it('falls back to the defaults when nothing is configured', () => {
    expect(nudgesFor(undefined)).toEqual([...DEFAULT_WHATSAPP_NUDGES]);
    expect(nudgesFor(null)).toEqual([...DEFAULT_WHATSAPP_NUDGES]);
    // Empty means "never set", not "none allowed" — that is the switch.
    expect(nudgesFor([])).toEqual([...DEFAULT_WHATSAPP_NUDGES]);
  });

  it('uses the workspace’s own wording when it has some', () => {
    expect(nudgesFor(['One', 'Two'])).toEqual(['One', 'Two']);
  });

  it('drops blank entries rather than sending an empty message', () => {
    expect(nudgesFor(['One', '   ', 'Two'])).toEqual(['One', 'Two']);
  });

  it('ships two messages by default, matching the two-reply allowance', () => {
    expect(DEFAULT_WHATSAPP_NUDGES).toHaveLength(2);
    expect(WHATSAPP_NUDGE_LIMIT).toBe(2);
  });
});

describe('nudgeAt', () => {
  const nudges = ['first', 'second'];

  it('hands out the messages in order, one per send', () => {
    expect(nudgeAt(nudges, 0)).toBe('first');
    expect(nudgeAt(nudges, 1)).toBe('second');
  });

  it('runs out rather than repeating the last one', () => {
    expect(nudgeAt(nudges, 2)).toBeNull();
    expect(nudgeAt(nudges, 99)).toBeNull();
  });

  it('is safe against a negative count', () => {
    expect(nudgeAt(nudges, -1)).toBeNull();
  });
});

describe('sameNudgeText', () => {
  const text = DEFAULT_WHATSAPP_NUDGES[0] as string;

  it('accepts the wording back exactly as it was given', () => {
    expect(sameNudgeText(text, text)).toBe(true);
  });

  it('forgives what a text box does to it on the way back', () => {
    // None of these change a single character the customer reads.
    expect(sameNudgeText(text.replace(/\n/g, '\r\n'), text)).toBe(true);
    expect(sameNudgeText(`  ${text}\n`, text)).toBe(true);
    expect(sameNudgeText(text.split('\n').map((l) => `${l}   `).join('\n'), text)).toBe(true);
  });

  it('refuses a changed word, which is a different message', () => {
    expect(sameNudgeText(text.replace('DEAR', 'HELLO'), text)).toBe(false);
    expect(sameNudgeText(`${text} call me on 99999`, text)).toBe(false);
    expect(sameNudgeText('', text)).toBe(false);
  });

  it('does not collapse the blank lines that shape the message', () => {
    expect(sameNudgeText(text.replace(/\n\n/g, '\n'), text)).toBe(false);
  });
});

describe('the allowance', () => {
  it('counts down from the workspace’s own limit', () => {
    expect(nudgesLeft(0, 2)).toBe(2);
    expect(nudgesLeft(1, 2)).toBe(1);
    expect(nudgesLeft(2, 2)).toBe(0);
  });

  it('never goes negative, however the count got ahead', () => {
    expect(nudgesLeft(5, 2)).toBe(0);
  });

  it('says the workspace’s number, not a constant, and reads for one', () => {
    expect(nudgeQuotaMessage(2)).toContain('Only 2 WhatsApp replies are');
    expect(nudgeQuotaMessage(1)).toContain('Only 1 WhatsApp reply is');
  });
});
