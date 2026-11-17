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

  it('counts an ordinary reply to a customer who has not written in 24 hours', () => {
    expect(countsAgainstNudgeQuota(ordinary)).toBe(true);
    expect(countsAgainstNudgeQuota({ ...ordinary, messageType: 'image' })).toBe(true);
    // A template is a message to the customer like any other. It is also
    // the expensive one, so exempting it would be the largest hole.
    expect(countsAgainstNudgeQuota({ ...ordinary, messageType: 'template' })).toBe(true);
  });

  it('counts a reply made inside the 24-hour window too', () => {
    // Deliberately not exempt — see the doc comment on
    // countsAgainstNudgeQuota for why an open window used to skip this
    // check and no longer does: the private chat link is the one way
    // through, whether or not the customer happened to write in recently.
    for (const messageType of ['text', 'image', 'video', 'audio', 'document', 'location', 'template']) {
      expect(countsAgainstNudgeQuota({ ...ordinary, messageType })).toBe(true);
    }
  });

  it('never counts a demo contact', () => {
    // Not a real WhatsApp number — those chats run on the mock gateway,
    // and a limit on an imaginary cost is just a broken sandbox.
    expect(countsAgainstNudgeQuota({ ...ordinary, isDemoContact: true })).toBe(false);
  });

  it('never counts a reaction', () => {
    expect(countsAgainstNudgeQuota({ ...ordinary, messageType: 'reaction' })).toBe(false);
  });

  it('never counts the automatic private-chat invitation', () => {
    // internal: true only ever means the automatic invitation
    // (guestAutoReply.service.ts) — its own maxSends caps it separately,
    // so it must not also spend one of the agent's own nudges.
    expect(countsAgainstNudgeQuota({ ...ordinary, internal: true })).toBe(false);
    expect(countsAgainstNudgeQuota({ ...ordinary, messageType: 'template', internal: true })).toBe(false);
  });

  it('still counts an agent-picked template, internal unset', () => {
    expect(countsAgainstNudgeQuota({ ...ordinary, messageType: 'template', internal: false })).toBe(true);
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
