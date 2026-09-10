import { broadcastGuestPresence, countGuestSockets } from './presence';
import { conversationRoom, phoneNumberRoom, tenantRoom } from './rooms';
import type { AppServer } from './types';

const GUEST = { tenantId: 't1', conversationId: 'c1', whatsappPhoneNumberId: 'n1' };

/** A chainable io double that records where an emit was addressed. */
function fakeIo() {
  const rooms: string[] = [];
  const emits: { event: string; payload: unknown }[] = [];
  const chain = {
    to(room: string) {
      rooms.push(room);
      return chain;
    },
    emit(event: string, payload: unknown) {
      emits.push({ event, payload });
      return true;
    },
  };
  return { io: { to: chain.to } as unknown as AppServer, rooms, emits };
}

describe('broadcastGuestPresence', () => {
  /**
   * The addressing is the whole feature. Sent to the conversation room it
   * would reach only agents who already have that chat open — precisely
   * the people who do not need telling — and nobody looking at the list
   * would ever see it.
   */
  it('goes to the agents who can see that number, not to the chat room', () => {
    const { io, rooms, emits } = fakeIo();
    broadcastGuestPresence(io, GUEST, true);

    expect(rooms).toContain(tenantRoom('t1'));
    expect(rooms).toContain(phoneNumberRoom('n1'));
    expect(rooms).not.toContain(conversationRoom('c1'));
    expect(emits).toEqual([
      { event: 'guest:presence', payload: { conversationId: 'c1', online: true } },
    ]);
  });

  it('says so when they leave', () => {
    const { io, emits } = fakeIo();
    broadcastGuestPresence(io, GUEST, false);
    expect(emits[0]?.payload).toEqual({ conversationId: 'c1', online: false });
  });
});

describe('countGuestSockets', () => {
  const withSockets = (sockets: unknown[]) =>
    ({ in: () => ({ fetchSockets: async () => sockets }) }) as unknown as AppServer;

  /**
   * An agent with the chat open sits in the same conversation room as the
   * customer. Counting them would mean presence never switches off — the
   * dot would stay green for as long as the agent kept the screen open,
   * which is exactly when it is being looked at.
   */
  it('counts only the customer, not agents in the same room', async () => {
    const io = withSockets([
      { data: { guest: { conversationId: 'c1' } } },
      { data: { auth: { userId: 'u1' } } },
      { data: {} },
    ]);
    await expect(countGuestSockets(io, 'c1')).resolves.toBe(1);
  });

  /** Two tabs are one customer, and closing one is not them leaving. */
  it('counts each window the customer has open', async () => {
    const io = withSockets([{ data: { guest: {} } }, { data: { guest: {} } }]);
    await expect(countGuestSockets(io, 'c1')).resolves.toBe(2);
  });

  it('reports nobody rather than throwing when the count fails', async () => {
    const io = {
      in: () => ({
        fetchSockets: async () => {
          throw new Error('adapter is down');
        },
      }),
    } as unknown as AppServer;
    // Zero is the safer wrong answer: an agent told nobody is there goes
    // back to the list, where the next message still reaches them.
    await expect(countGuestSockets(io, 'c1')).resolves.toBe(0);
  });
});
