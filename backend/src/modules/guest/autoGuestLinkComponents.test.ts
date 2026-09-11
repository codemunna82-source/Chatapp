import { buildAutoGuestLinkComponents } from './guestAutoReply.service';

/** The shape the builder emits, narrowed for assertions. */
interface Component {
  type: string;
  sub_type?: string;
  index?: string;
  parameters: { type: string; text: string }[];
}

const asComponents = (value: unknown[]): Component[] => value as Component[];

/**
 * No database: the builder is pure, and its output is the exact JSON Meta
 * validates a template send against. Meta rejects the send outright when
 * the components do not match the approved template — a body parameter
 * sent to a template with no variables fails exactly as hard as a missing
 * one — and that rejection lands inside the webhook handler, where it is
 * logged and nobody is watching. A customer simply never gets invited.
 */
describe('buildAutoGuestLinkComponents', () => {
  const token = 'AbC-123_xyz';

  it('sends only the button component for a template with no body variable', () => {
    expect(buildAutoGuestLinkComponents(null, token, 'none')).toEqual([
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] },
    ]);
  });

  it('puts the bare token in the button, never a URL', () => {
    // Meta appends this to the address saved with the template, so sending
    // a full URL yields https://app/c/https://app/c/<token> — a dead link
    // that still sends successfully, which is the worst kind of failure.
    const button = asComponents(buildAutoGuestLinkComponents(null, token, 'none'))[0]!;
    expect(button.parameters[0]!.text).toBe(token);
    expect(button.parameters[0]!.text).not.toContain('http');
    expect(button.parameters[0]!.text).not.toContain('/c/');
  });

  it('adds the body parameter before the button when the template takes a name', () => {
    // Order matters to Meta: body components come before button components.
    expect(buildAutoGuestLinkComponents('Priya', token, 'customer_name')).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Priya' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] },
    ]);
  });

  it('falls back to a word rather than an empty parameter for an unnamed contact', () => {
    // Most customers message before anyone names them, and Meta rejects a
    // blank parameter — so this is the common case, not the edge case.
    const body = asComponents(buildAutoGuestLinkComponents(null, token, 'customer_name'))[0]!;
    expect(body.parameters[0]!.text).toBe('there');
    expect(body.parameters[0]!.text.length).toBeGreaterThan(0);
  });

  it('never sends a body component when the template has no variable', () => {
    // Even with a name to hand: the setting describes the template, and a
    // parameter the template does not declare fails the whole send.
    const components = buildAutoGuestLinkComponents('Priya', token, 'none');
    expect(components).toHaveLength(1);
    expect(components).not.toContainEqual(expect.objectContaining({ type: 'body' }));
  });
});
