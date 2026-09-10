import { guestReactionSchema } from './guest.validation';

describe('guestReactionSchema', () => {
  const parse = (emoji: string) =>
    guestReactionSchema.safeParse({ messageId: '507f1f77bcf86cd799439011', emoji });

  it('accepts a plain emoji', () => {
    expect(parse('👍').success).toBe(true);
  });

  /**
   * The regression this file exists for. The bound counts UTF-16 units,
   * not characters: a family is four faces joined by zero-width joiners
   * and comes to eleven of them, so the old limit of eight rejected it
   * with a 400 — for a reaction any phone keyboard offers.
   */
  it('accepts emoji built from joined sequences', () => {
    expect('👨‍👩‍👧‍👦'.length).toBeGreaterThan(8);
    expect(parse('👨‍👩‍👧‍👦').success).toBe(true);
    expect(parse('👍🏽').success).toBe(true);
    expect(parse('🏳️‍🌈').success).toBe(true);
  });

  it('accepts an empty string, which means remove', () => {
    expect(parse('').success).toBe(true);
  });

  it('still refuses something the size of a message', () => {
    expect(parse('x'.repeat(64)).success).toBe(false);
  });

  it('refuses a message id that is not one', () => {
    expect(guestReactionSchema.safeParse({ messageId: 'nope', emoji: '👍' }).success).toBe(false);
  });
});
