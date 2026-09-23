import { renderAutoGuestLinkText, DEFAULT_AUTO_GUEST_LINK_TEXT } from './tenant.model';

/**
 * The invitation text a customer actually receives.
 *
 * Pure, so no database — and worth pinning because the failure mode is
 * silent from every direction: a message with no link in it sends
 * perfectly, reads fine, and simply cannot be acted on. Nothing
 * downstream would ever flag it.
 */
describe('renderAutoGuestLinkText', () => {
  const url = 'https://www.waprivate.dev/c/abc123';

  it('puts the customer’s own link into the default wording', () => {
    const text = renderAutoGuestLinkText(undefined, url);
    expect(text).toContain(url);
    expect(text).not.toContain('{{link}}');
  });

  it('keeps the link on its own line', () => {
    // WhatsApp only renders a tappable preview for a URL that stands
    // alone; buried mid-sentence it is just text the customer must copy.
    const lines = renderAutoGuestLinkText(undefined, url).split('\n');
    expect(lines).toContain(url);
  });

  it('substitutes every occurrence, not just the first', () => {
    expect(renderAutoGuestLinkText('Tap {{link}} — again: {{link}}', url)).toBe(
      `Tap ${url} — again: ${url}`,
    );
  });

  it('appends the URL when the wording forgot the placeholder', () => {
    // The quiet failure this guards: an invitation with nothing to tap.
    expect(renderAutoGuestLinkText('Chat with us privately', url)).toBe(
      `Chat with us privately\n${url}`,
    );
  });

  it('ships a default that already contains the placeholder', () => {
    // Otherwise every workspace that never edits the wording gets the
    // append path, which reads worse than the text that was written.
    expect(DEFAULT_AUTO_GUEST_LINK_TEXT).toContain('{{link}}');
  });

  it('trims surrounding whitespace', () => {
    expect(renderAutoGuestLinkText('  Hello {{link}}  ', url)).toBe(`Hello ${url}`);
  });
});
