import {
  countsAgainstNudgeQuota,
  nudgesLeft,
  nudgeWindowStart,
  WHATSAPP_NUDGE_LIMIT,
} from './whatsappQuota';

/**
 * No database. This decides whether an agent can reach a customer at all,
 * and every wrong answer is expensive in one direction or the other —
 * either a workspace locked out of a conversation it was mid-way through,
 * or a cap that never actually caps.
 */

describe('countsAgainstNudgeQuota', () => {
  const ordinary = { messageType: 'text', isDemoContact: false };

  it('counts an ordinary reply', () => {
    expect(countsAgainstNudgeQuota(ordinary)).toBe(true);
    expect(countsAgainstNudgeQuota({ messageType: 'image', isDemoContact: false })).toBe(true);
    // A template is a message to the customer like any other. It is also
    // the expensive one, so exempting it would be the largest hole.
    expect(countsAgainstNudgeQuota({ messageType: 'template', isDemoContact: false })).toBe(true);
  });

  it('never counts the private-chat invitation', () => {
    // It is the way OUT of the cap. Counting it would let a customer who
    // has not opened their link become unreachable, with no way left to
    // send them one.
    expect(countsAgainstNudgeQuota({ ...ordinary, internal: true })).toBe(false);
    expect(countsAgainstNudgeQuota({ messageType: 'template', isDemoContact: false, internal: true })).toBe(
      false,
    );
  });

  it('never counts a demo contact', () => {
    // Not a real WhatsApp number — those chats run on the mock gateway,
    // and a limit on an imaginary cost is just a broken sandbox.
    expect(countsAgainstNudgeQuota({ ...ordinary, isDemoContact: true })).toBe(false);
  });

  it('never counts a reaction', () => {
    expect(countsAgainstNudgeQuota({ messageType: 'reaction', isDemoContact: false })).toBe(false);
  });
});

describe('nudgeWindowStart', () => {
  const activatedAt = new Date('2026-09-01T10:00:00Z');
  const lastSeenAt = new Date('2026-09-10T10:00:00Z');

  it('counts the whole conversation when the link was never opened', () => {
    expect(nudgeWindowStart(null)).toBeNull();
    expect(nudgeWindowStart({ activatedAt: undefined, lastSeenAt: undefined } as never)).toBeNull();
  });

  it('restarts from the customer’s last visit', () => {
    // Someone who used the window and drifted off gets a fresh three —
    // the same "come back" the first three were for.
    expect(nudgeWindowStart({ activatedAt, lastSeenAt } as never)).toBe(lastSeenAt);
  });

  it('falls back to activation when they opened it and never returned', () => {
    expect(nudgeWindowStart({ activatedAt, lastSeenAt: undefined } as never)).toBe(activatedAt);
  });
});

describe('nudgesLeft', () => {
  it('counts down and stops at zero', () => {
    expect(nudgesLeft(0)).toBe(WHATSAPP_NUDGE_LIMIT);
    expect(nudgesLeft(1)).toBe(WHATSAPP_NUDGE_LIMIT - 1);
    expect(nudgesLeft(WHATSAPP_NUDGE_LIMIT)).toBe(0);
    // Never negative: a conversation that somehow went over reports
    // "none left", which is what the agent can act on.
    expect(nudgesLeft(WHATSAPP_NUDGE_LIMIT + 5)).toBe(0);
  });
});
