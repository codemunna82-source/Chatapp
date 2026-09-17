import { messageFailureReason } from './messageFailureReason';

describe('messageFailureReason', () => {
  it('names the billing problem and who fixes it', () => {
    const reason = messageFailureReason([
      { code: 131042, title: 'Business eligibility payment issue' },
    ]);
    expect(reason).toContain('payment method');
    expect(reason).toContain('admin');
  });

  it('says a template is missing in this language, not that the send is broken', () => {
    expect(messageFailureReason([{ code: 132001, title: 'x' }])).toContain('language');
  });

  it('reassures when Meta throttled a marketing message', () => {
    expect(messageFailureReason([{ code: 131049 }])).toContain('Nothing is wrong with the message');
  });

  // Meta adds codes without telling anyone. An unknown one still has to
  // say something — its own title is better than a shrug.
  it('falls back to Meta’s own title for a code it does not know', () => {
    expect(messageFailureReason([{ code: 999999, title: 'Something odd' }])).toBe(
      'WhatsApp did not deliver this: Something odd.',
    );
  });

  it('still says it failed when there is no title either', () => {
    expect(messageFailureReason([{ code: 999999 }])).toBe('WhatsApp did not deliver this message.');
  });

  // Straight from a webhook body, so every one of these is a shape that
  // can actually arrive.
  it('survives a payload that is not the expected shape', () => {
    expect(messageFailureReason(undefined)).toBeUndefined();
    expect(messageFailureReason([])).toBeUndefined();
    expect(messageFailureReason('nope')).toBeUndefined();
    expect(messageFailureReason([null])).toBeUndefined();
    // A bare object rather than an array — read, not discarded.
    expect(messageFailureReason({ code: 131042 })).toContain('payment method');
  });

  it('ignores a blank title rather than printing an empty sentence', () => {
    expect(messageFailureReason([{ code: 999999, title: '   ' }])).toBe(
      'WhatsApp did not deliver this message.',
    );
  });
});
