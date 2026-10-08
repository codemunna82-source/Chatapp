/**
 * Without Redis configured (the state every other test in this repo runs
 * in), pacing must fail open — a safeguard that itself blocks sends would
 * be worse than no safeguard at all.
 */
import { tryReserveAutomaticSendSlot } from './outboundPacing';

describe('tryReserveAutomaticSendSlot', () => {
  it('allows the send when there is no Redis to count against', async () => {
    expect(await tryReserveAutomaticSendSlot('123456')).toBe(true);
  });
});
