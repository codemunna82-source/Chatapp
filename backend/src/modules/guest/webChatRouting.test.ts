import { resolveReplyChannel, hasMovedToWebChat } from './webChatRouting';

type Session = Parameters<typeof hasMovedToWebChat>[0];

const opened = { activatedAt: new Date('2026-09-12T10:00:00Z') } as Session;
const issuedNotOpened = { activatedAt: undefined } as Session;
const blocked = {
  activatedAt: new Date('2026-09-12T10:00:00Z'),
  blockedAt: new Date('2026-09-12T11:00:00Z'),
} as Session;

describe('hasMovedToWebChat', () => {
  it('is true once the customer has used the window', () => {
    expect(hasMovedToWebChat(opened)).toBe(true);
  });

  // The bug that made this necessary: a link that was merely sent is not
  // evidence the customer ever tapped it, and routing on that would send
  // replies into a window nobody opened.
  it('is false for a link that was issued but never opened', () => {
    expect(hasMovedToWebChat(issuedNotOpened)).toBe(false);
  });

  it('is false with no session at all', () => {
    expect(hasMovedToWebChat(null)).toBe(false);
  });

  // A block closes the window, not WhatsApp. Replies must go back to
  // WhatsApp rather than into a window that will never show them.
  it('is false once the customer has blocked the window', () => {
    expect(hasMovedToWebChat(blocked)).toBe(false);
  });
});

describe('resolveReplyChannel', () => {
  it('sends to the web window once the customer has moved there', () => {
    expect(resolveReplyChannel({ messageType: 'text', isDemoContact: false, session: opened })).toBe('web');
  });

  // The double-delivery this whole module exists to stop: the reply must
  // go to exactly one of the two places, never both.
  it('sends to WhatsApp while the customer has not opened the window', () => {
    expect(
      resolveReplyChannel({ messageType: 'text', isDemoContact: false, session: issuedNotOpened }),
    ).toBe('whatsapp');
    expect(resolveReplyChannel({ messageType: 'text', isDemoContact: false, session: null })).toBe(
      'whatsapp',
    );
  });

  it('falls back to WhatsApp when the customer has blocked the window', () => {
    expect(resolveReplyChannel({ messageType: 'text', isDemoContact: false, session: blocked })).toBe(
      'whatsapp',
    );
  });

  // A template exists only to reopen Meta's 24-hour window. Rerouting one
  // to the web window would leave the agent believing they had reopened a
  // window that is still shut.
  it('always sends a template through WhatsApp', () => {
    expect(resolveReplyChannel({ messageType: 'template', isDemoContact: false, session: opened })).toBe(
      'whatsapp',
    );
  });

  it('keeps demo contacts on their sandbox gateway', () => {
    expect(resolveReplyChannel({ messageType: 'text', isDemoContact: true, session: opened })).toBe(
      'whatsapp',
    );
  });

  it('routes media the same way as text', () => {
    for (const type of ['image', 'video', 'audio', 'document']) {
      expect(resolveReplyChannel({ messageType: type, isDemoContact: false, session: opened })).toBe('web');
      expect(
        resolveReplyChannel({ messageType: type, isDemoContact: false, session: issuedNotOpened }),
      ).toBe('whatsapp');
    }
  });
});
