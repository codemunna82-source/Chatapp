import { sendMessageSchema } from './message.validation';

/**
 * The retry contract, at the edge where it is easiest to break.
 *
 * The whole protection rests on the id surviving the round trip: if
 * validation strips it, every retry becomes a new message and the bug is
 * back with no test failing.
 */
describe('sendMessageSchema — clientMessageId', () => {
  it('carries the id through on a text send', () => {
    const parsed = sendMessageSchema.parse({
      type: 'text',
      text: 'hello',
      clientMessageId: 'local-1789-0',
    });
    expect(parsed).toMatchObject({ clientMessageId: 'local-1789-0' });
  });

  it('carries it on media and on a reaction', () => {
    expect(
      sendMessageSchema.parse({ type: 'image', mediaId: 'm1', clientMessageId: 'c-1' }),
    ).toMatchObject({ clientMessageId: 'c-1' });
    expect(
      sendMessageSchema.parse({ type: 'reaction', reactToMessageId: 'm1', emoji: '👍', clientMessageId: 'c-2' }),
    ).toMatchObject({ clientMessageId: 'c-2' });
  });

  // Older builds send none. Refusing those would break every installed
  // app for a field that only ever adds protection.
  it('accepts a send without one', () => {
    const parsed = sendMessageSchema.parse({ type: 'text', text: 'hello' });
    expect(parsed).not.toHaveProperty('clientMessageId');
  });

  it('refuses an empty or oversized id rather than storing junk', () => {
    expect(() => sendMessageSchema.parse({ type: 'text', text: 'x', clientMessageId: '' })).toThrow();
    expect(() =>
      sendMessageSchema.parse({ type: 'text', text: 'x', clientMessageId: 'a'.repeat(129) }),
    ).toThrow();
  });
});
