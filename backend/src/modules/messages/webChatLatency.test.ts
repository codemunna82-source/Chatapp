/**
 * What the customer's window actually waits for.
 *
 * A reply sent from the app took 2.1 seconds to leave the server — on a
 * socket that then delivered it in milliseconds. None of that was the
 * socket: it was eight database round trips standing in a queue in front
 * of the emit, each one ~235 ms to an Atlas cluster on the far side of
 * the world from the Render instance.
 *
 * Two properties fixed it, and both are invisible from the outside — the
 * message still arrives, just late — so they are asserted here rather
 * than left to be re-broken by the next person who adds "one more small
 * lookup" to the send path:
 *
 *   1. the reads that do not depend on each other are issued together;
 *   2. nothing that the delivery does not depend on runs before the emit.
 *
 * Every collaborator is mocked, so this runs without a database — the
 * suite cannot reach one from here (mongodb-memory-server's download is
 * blocked by the egress proxy), and the ordering is the point either way.
 */
import { Types } from 'mongoose';

const order: string[] = [];
/** Resolves on a later tick, so a caller that awaits sequentially cannot
 *  be mistaken for one that batched — a sequential pair would interleave
 *  start/finish, a batched pair records both starts first. */
const traced = <T>(label: string, value: T) =>
  new Promise<T>((resolve) => {
    order.push(`${label}:start`);
    setTimeout(() => {
      order.push(label);
      resolve(value);
    }, 5);
  });

/**
 * Waits for a label to appear rather than sleeping a fixed time.
 *
 * The push is deliberately NOT awaited by the send — that is half of what
 * this file is testing — so the assertions have to wait for it some other
 * way. A fixed sleep was that other way for one afternoon: it passed
 * alone and failed inside the full suite, where several workers share a
 * machine and a 40 ms budget stops meaning 40 ms. Polling for the thing
 * itself is correct at any speed.
 */
async function until(label: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!order.includes(label)) {
    if (Date.now() > deadline) throw new Error(`"${label}" never happened`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const TENANT = new Types.ObjectId();
const CONVERSATION = new Types.ObjectId();
const CONTACT = new Types.ObjectId();
const PHONE_NUMBER = new Types.ObjectId();

const conversationDoc = {
  _id: CONVERSATION,
  tenantId: TENANT,
  contactId: CONTACT,
  whatsappPhoneNumberId: PHONE_NUMBER,
  unreadCount: 0,
};

const messageDoc = {
  _id: new Types.ObjectId(),
  conversationId: CONVERSATION,
  direction: 'OUT' as const,
  type: 'text',
  text: 'on its way',
  status: 'SENT',
  createdAt: new Date(),
};

jest.mock('../conversations/conversation.repository', () => ({
  findConversationByIdAndTenant: jest.fn(() => traced('conversation', conversationDoc)),
  recordOutboundActivity: jest.fn(() => traced('recordOutboundActivity', conversationDoc)),
  isWithinCustomerServiceWindow: () => true,
}));

jest.mock('../contacts/contact.repository', () => ({
  findContactByIdAndTenant: jest.fn(() => traced('contact', { _id: CONTACT, phone: '+919876543210' })),
}));

jest.mock('./message.repository', () => ({
  createMessage: jest.fn(() => traced('createMessage', messageDoc)),
  findMessageByIdAndTenant: jest.fn(() => traced('replyTarget', null)),
  findMessageByClientId: jest.fn(() => traced('dedupe', null)),
  attachMetaMessageId: jest.fn(),
  markMessageFailed: jest.fn(),
  softDeleteMessage: jest.fn(),
  setMessageStarred: jest.fn(),
}));

jest.mock('../guest/guestSession.repository', () => ({
  // Opened moments ago, so resolveReplyChannel routes this to the window.
  findActiveSessionForConversation: jest.fn(() =>
    traced('guestSession', { lastSeenAt: new Date(), activatedAt: new Date() }),
  ),
}));

jest.mock('../guest/guestPush.service', () => ({
  pushGuestMessage: jest.fn(() => traced('push', undefined)),
}));

jest.mock('../guest/businessName', () => ({
  resolveBusinessNameForConversation: jest.fn(() => traced('businessName', { name: 'VOXO' })),
}));

jest.mock('../../realtime/events', () => ({
  getRealtimeEmitter: () => ({
    emitMessageNew: jest.fn(() => {
      order.push('emitMessageNew');
    }),
    emitConversationUpdated: jest.fn(() => {
      order.push('emitConversationUpdated');
    }),
  }),
}));

import { sendOutboundMessage } from './message.service';

describe('a reply routed to the private web window', () => {
  beforeEach(() => {
    order.length = 0;
  });

  async function send(extra: Record<string, unknown> = {}) {
    await sendOutboundMessage({
      tenantId: String(TENANT),
      conversationId: String(CONVERSATION),
      type: 'text',
      text: 'on its way',
      ...extra,
    } as never);
  }

  it('reaches the socket before anything the delivery does not need', async () => {
    await send();
    await until('push:start');

    const emit = order.indexOf('emitMessageNew');
    expect(emit).toBeGreaterThan(-1);

    // The row's preview text is for the agent's own chat list. It used to
    // be written first, which put a round trip in front of every message.
    expect(order.indexOf('recordOutboundActivity')).toBeGreaterThan(emit);

    // The push is for a window that is NOT open. Waiting on a name lookup
    // and a round trip to Google before delivering to one that IS open is
    // the wrong way round.
    expect(order.indexOf('businessName:start')).toBeGreaterThan(emit);
    expect(order.indexOf('push:start')).toBeGreaterThan(emit);
  });

  it('issues the independent reads together rather than one at a time', async () => {
    await send({ clientMessageId: 'local-1', replyToMessageId: String(new Types.ObjectId()) });

    // All four start before any of them finishes. Awaited one by one,
    // "contact" would land before "dedupe:start".
    const starts = ['contact:start', 'dedupe:start', 'guestSession:start', 'replyTarget:start'];
    const lastStart = Math.max(...starts.map((s) => order.indexOf(s)));
    expect(starts.every((s) => order.indexOf(s) > -1)).toBe(true);
    expect(order.indexOf('contact')).toBeGreaterThan(lastStart);
  });

  it('does not re-read a conversation the caller already has', async () => {
    const { findConversationByIdAndTenant } = jest.requireMock('../conversations/conversation.repository');
    findConversationByIdAndTenant.mockClear();

    await send({ conversation: conversationDoc });

    expect(findConversationByIdAndTenant).not.toHaveBeenCalled();
    expect(order).toContain('emitMessageNew');
  });
});
