import { resolveReplyChannel, hasMovedToWebChat } from './webChatRouting';

type Session = Parameters<typeof hasMovedToWebChat>[0];

const NOW = new Date('2026-09-12T12:00:00Z');

/** Opened the link an hour ago — lastSeenAt is written on every guest request. */
const opened = { lastSeenAt: new Date('2026-09-12T11:00:00Z') } as Session;
/** A link that was sent into the WhatsApp thread and never tapped. */
const issuedNotOpened = {} as Session;
const blocked = {
  lastSeenAt: new Date('2026-09-12T11:00:00Z'),
  blockedAt: new Date('2026-09-12T11:30:00Z'),
} as Session;
/** Opened once, three weeks ago, and never returned to. */
const abandoned = { lastSeenAt: new Date('2026-08-22T10:00:00Z') } as Session;

describe('hasMovedToWebChat', () => {
  it('is true once the customer has opened the window', () => {
    expect(hasMovedToWebChat(opened, NOW)).toBe(true);
  });

  // Opening is enough — the customer is reading there whether or not they
  // have typed anything back yet.
  it('does not wait for the customer to type before routing there', () => {
    expect(hasMovedToWebChat({ lastSeenAt: NOW } as Session, NOW)).toBe(true);
  });

  // Otherwise a customer who looked once and wandered off would have
  // every later reply routed to a page they are not watching.
  it('goes back to WhatsApp once the window has been abandoned', () => {
    expect(hasMovedToWebChat(abandoned, NOW)).toBe(false);
  });

  // The bug that made this necessary: a link that was merely sent is not
  // evidence the customer ever tapped it, and routing on that would send
  // replies into a window nobody opened.
  it('is false for a link that was issued but never opened', () => {
    expect(hasMovedToWebChat(issuedNotOpened, NOW)).toBe(false);
  });

  it('is false with no session at all', () => {
    expect(hasMovedToWebChat(null, NOW)).toBe(false);
  });

  // A block closes the window, not WhatsApp. Replies must go back to
  // WhatsApp rather than into a window that will never show them.
  it('is false once the customer has blocked the window', () => {
    expect(hasMovedToWebChat(blocked, NOW)).toBe(false);
  });
});

describe('resolveReplyChannel', () => {
  it('sends to the web window once the customer has moved there', () => {
    expect(resolveReplyChannel({ messageType: 'text', isDemoContact: false, session: opened }, NOW)).toBe('web');
  });

  // The double-delivery this whole module exists to stop: the reply must
  // go to exactly one of the two places, never both.
  it('sends to WhatsApp while the customer has not opened the window', () => {
    expect(
      resolveReplyChannel({ messageType: 'text', isDemoContact: false, session: issuedNotOpened }, NOW),
    ).toBe('whatsapp');
    expect(resolveReplyChannel({ messageType: 'text', isDemoContact: false, session: null }, NOW)).toBe(
      'whatsapp',
    );
  });

  it('falls back to WhatsApp when the customer has blocked the window', () => {
    expect(resolveReplyChannel({ messageType: 'text', isDemoContact: false, session: blocked }, NOW)).toBe(
      'whatsapp',
    );
  });

  // A template exists only to reopen Meta's 24-hour window. Rerouting one
  // to the web window would leave the agent believing they had reopened a
  // window that is still shut.
  it('always sends a template through WhatsApp', () => {
    expect(resolveReplyChannel({ messageType: 'template', isDemoContact: false, session: opened }, NOW)).toBe(
      'whatsapp',
    );
  });

  it('keeps demo contacts on their sandbox gateway', () => {
    expect(resolveReplyChannel({ messageType: 'text', isDemoContact: true, session: opened }, NOW)).toBe(
      'whatsapp',
    );
  });

  it('routes media the same way as text', () => {
    for (const type of ['image', 'video', 'audio', 'document']) {
      expect(resolveReplyChannel({ messageType: type, isDemoContact: false, session: opened }, NOW)).toBe('web');
      expect(
        resolveReplyChannel({ messageType: type, isDemoContact: false, session: issuedNotOpened }, NOW),
      ).toBe('whatsapp');
    }
  });
});
