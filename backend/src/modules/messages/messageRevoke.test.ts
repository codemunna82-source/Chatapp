import { messageChannel, refusalToRevoke, REVOKE_WINDOW_MS } from './messageRevoke';

/**
 * No database. These are the rules that decide whether a message can be
 * withdrawn from someone else's screen, and the expensive failure — a
 * WhatsApp message cleared here while the customer still has it on their
 * phone — is a pure-logic mistake, so it is tested as pure logic.
 */

const NOW = new Date('2026-09-15T12:00:00Z');
const justNow = new Date(NOW.getTime() - 1000);

describe('messageChannel', () => {
  it('trusts the stored channel', () => {
    expect(messageChannel({ channel: 'web', metaMessageId: 'wamid.X' })).toBe('web');
    expect(messageChannel({ channel: 'whatsapp' })).toBe('whatsapp');
  });

  it("falls back to Meta's own id for rows written before the field existed", () => {
    expect(messageChannel({ metaMessageId: 'wamid.HBgM' })).toBe('whatsapp');
    expect(messageChannel({})).toBe('web');
  });
});

describe('refusalToRevoke', () => {
  const webOut = { channel: 'web' as const, direction: 'OUT' as const, createdAt: justNow };
  const webIn = { channel: 'web' as const, direction: 'IN' as const, createdAt: justNow };

  it('lets an agent take back their own web-chat message', () => {
    expect(refusalToRevoke(webOut, 'agent', NOW)).toBeNull();
  });

  it('lets the customer take back their own web-chat message', () => {
    expect(refusalToRevoke(webIn, 'customer', NOW)).toBeNull();
  });

  it('refuses a WhatsApp message outright — Meta cannot recall one', () => {
    expect(refusalToRevoke({ ...webOut, channel: 'whatsapp' }, 'agent', NOW)).toBe('NOT_WEB_CHANNEL');
  });

  it('treats an old row with a wamid as WhatsApp', () => {
    const legacy = { direction: 'OUT' as const, createdAt: justNow, metaMessageId: 'wamid.X' };
    expect(refusalToRevoke(legacy, 'agent', NOW)).toBe('NOT_WEB_CHANNEL');
  });

  it('will not let an agent unsend the customer’s message', () => {
    expect(refusalToRevoke(webIn, 'agent', NOW)).toBe('NOT_YOURS');
  });

  it("will not let the customer unsend the business's message", () => {
    expect(refusalToRevoke(webOut, 'customer', NOW)).toBe('NOT_YOURS');
  });

  it('refuses once the window has passed', () => {
    const old = { ...webOut, createdAt: new Date(NOW.getTime() - REVOKE_WINDOW_MS - 1) };
    expect(refusalToRevoke(old, 'agent', NOW)).toBe('WINDOW_PASSED');
  });

  it('still allows it at the very edge of the window', () => {
    const edge = { ...webOut, createdAt: new Date(NOW.getTime() - REVOKE_WINDOW_MS) };
    expect(refusalToRevoke(edge, 'agent', NOW)).toBeNull();
  });

  it('refuses a message that is already gone, whatever else is true', () => {
    const gone = { ...webOut, revokedAt: justNow };
    expect(refusalToRevoke(gone, 'agent', NOW)).toBe('ALREADY_REVOKED');
    // Checked before the channel, so a double tap on a WhatsApp message
    // that somehow got revoked reports what actually happened.
    expect(refusalToRevoke({ ...gone, channel: 'whatsapp' }, 'agent', NOW)).toBe('ALREADY_REVOKED');
  });
});
