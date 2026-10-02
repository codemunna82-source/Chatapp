import { shouldAskMeta, resetSendBlockDiagnostics } from './sendBlockDiagnostics';

/**
 * The throttle, which is the whole reason this is safe to call from the
 * webhook path. A refused send arrives in bursts — the agent taps retry,
 * the outbox replays — and one Graph call per failed message would add a
 * rate limit to an outage.
 */
describe('shouldAskMeta', () => {
  beforeEach(resetSendBlockDiagnostics);

  const t0 = new Date('2026-10-02T19:00:00Z').getTime();

  it('asks the first time', () => {
    expect(shouldAskMeta('1390492767471371', t0)).toBe(true);
  });

  it('does not ask again during the window, however many failures arrive', () => {
    expect(shouldAskMeta('1390492767471371', t0)).toBe(true);
    for (const after of [1, 1_000, 60_000, 9 * 60 * 1000 + 59_000]) {
      expect(shouldAskMeta('1390492767471371', t0 + after)).toBe(false);
    }
  });

  it('asks again once the window has passed', () => {
    expect(shouldAskMeta('1390492767471371', t0)).toBe(true);
    expect(shouldAskMeta('1390492767471371', t0 + 10 * 60 * 1000)).toBe(true);
  });

  it('throttles each number separately', () => {
    // A workspace with two blocked numbers must not have the first one's
    // answer silence the second: they can be blocked for different reasons,
    // and the second is the one nobody would think to check.
    expect(shouldAskMeta('1390492767471371', t0)).toBe(true);
    expect(shouldAskMeta('9999999999', t0)).toBe(true);
  });
});
