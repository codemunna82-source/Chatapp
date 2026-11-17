/**
 * Without Redis configured (the state every other test in this repo runs
 * in), pacing must fail open — a safeguard that itself blocks a real send
 * would be worse than no safeguard at all. See outboundPacing.test.ts for
 * the same contract on the automatic-invitation-only budget.
 */
import { trySlotForDispatch } from './sendPacing';

describe('trySlotForDispatch', () => {
  it('allows the send when there is no Redis to count against', async () => {
    expect(await trySlotForDispatch('123456', 'tenant-1')).toBe(true);
  });
});
