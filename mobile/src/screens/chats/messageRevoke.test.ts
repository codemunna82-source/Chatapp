import { canDeleteForEveryone, revokedLine } from './messageRevoke';
import type { Message } from '../../api/types';

/**
 * The client half of the delete-for-everyone rule. The server enforces
 * the real one, so a mistake here does not let anything through — it
 * offers a button that then fails, which is its own kind of broken.
 */

const NOW = Date.parse('2026-09-15T12:00:00Z');

function message(over: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    conversationId: 'c1',
    direction: 'OUT',
    type: 'text',
    text: 'hello',
    status: 'SENT',
    channel: 'web',
    createdAt: new Date(NOW - 60_000).toISOString(),
    ...over,
  } as Message;
}

describe('canDeleteForEveryone', () => {
  it('offers it on our own recent web-chat message', () => {
    expect(canDeleteForEveryone(message(), NOW)).toBe(true);
  });

  it("never offers it on the customer's message", () => {
    expect(canDeleteForEveryone(message({ direction: 'IN' }), NOW)).toBe(false);
  });

  it('never offers it on a WhatsApp message — Meta cannot recall one', () => {
    expect(canDeleteForEveryone(message({ channel: 'whatsapp' }), NOW)).toBe(false);
  });

  it('treats a message with no channel as WhatsApp', () => {
    // Rows written before the field existed. Withholding the button is
    // the safe way to be wrong.
    expect(canDeleteForEveryone(message({ channel: undefined }), NOW)).toBe(false);
  });

  it('stops offering it after an hour', () => {
    const old = message({ createdAt: new Date(NOW - 61 * 60 * 1000).toISOString() });
    expect(canDeleteForEveryone(old, NOW)).toBe(false);
  });

  it('does not offer it twice', () => {
    expect(canDeleteForEveryone(message({ revokedAt: new Date().toISOString() }), NOW)).toBe(false);
  });
});

describe('revokedLine', () => {
  it('says "you" for the workspace, whoever in it pressed it', () => {
    expect(revokedLine(message({ revokedBy: 'agent' }))).toBe('You deleted this message');
  });

  it('stays neutral about the customer', () => {
    expect(revokedLine(message({ direction: 'IN', revokedBy: 'customer' }))).toBe('This message was deleted');
  });
});
