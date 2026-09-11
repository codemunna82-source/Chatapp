import { renderAutoGuestLinkMessage, DEFAULT_AUTO_GUEST_LINK_MESSAGE } from './tenant.model';

/**
 * No database: the substitution is pure, and the thing worth pinning down
 * is that a link always ends up in the message. This text is sent to a
 * real customer from inside a webhook handler, where a wrong result is
 * invisible — nobody sees "we sent an invitation with no invitation in it".
 */
describe('renderAutoGuestLinkMessage', () => {
  const url = 'https://chat.example.com/c/abc123';

  it('substitutes {{link}} in the default wording', () => {
    const text = renderAutoGuestLinkMessage(undefined, url);
    expect(text).toContain(url);
    expect(text).not.toContain('{{link}}');
  });

  it('uses the default when no wording was saved', () => {
    expect(renderAutoGuestLinkMessage(undefined, url)).toBe(
      DEFAULT_AUTO_GUEST_LINK_MESSAGE.replace('{{link}}', url),
    );
  });

  it('substitutes every occurrence, not just the first', () => {
    // A business writing "tap {{link}} — that's {{link}}" would otherwise
    // send the placeholder itself to a customer.
    const text = renderAutoGuestLinkMessage('Tap {{link}} — again: {{link}}', url);
    expect(text).toBe(`Tap ${url} — again: ${url}`);
    expect(text).not.toContain('{{link}}');
  });

  it('appends the URL when the wording forgot the placeholder', () => {
    // The failure this guards against is the quiet one: a message that
    // sends successfully, reads fine, and contains nothing to tap.
    const text = renderAutoGuestLinkMessage('Chat with us privately', url);
    expect(text).toBe(`Chat with us privately\n${url}`);
  });

  it('appends the URL for wording that is only whitespace around no link', () => {
    expect(renderAutoGuestLinkMessage('   Hello   ', url)).toBe(`Hello\n${url}`);
  });
});
