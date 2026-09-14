/**
 * Where a message's milliseconds go on this device.
 *
 * The server can only ever account for its own share; the two ends of a
 * chat are two other clocks, and "the message took three seconds" is a
 * claim about all three. This is the device half: it marks the moments
 * the app itself controls, so backend time, network time and rendering
 * time can be told apart instead of argued about.
 *
 * DEV ONLY. Every function below compiles to a guard and a return in a
 * release build, so a shipped app pays nothing and logs nothing — this
 * exists to answer a question during development, not to run in
 * production, and a perf logger left on in production is a perf problem.
 *
 * A note on the one measurement this CANNOT make honestly: the hop from
 * the server's emit to this device's socket callback spans two clocks,
 * and phone clocks drift. Comparing a server timestamp to Date.now() here
 * gives a number that includes the skew and looks authoritative. So it is
 * not offered. Measure that hop the way it is done below — as part of a
 * round trip on ONE clock — or accept it as the remainder of a total.
 */
type Marks = { startedAt: number; last: number; stages: Record<string, number> };

const traces = new Map<string, Marks>();

/**
 * Bounded on purpose. A trace whose end never arrives — a send that
 * failed, a screen left mid-flight — would otherwise sit here for the
 * life of the process, and the whole point is that this costs nothing.
 */
const MAX_OPEN_TRACES = 64;

export function perfStart(id: string, label: string): void {
  if (!__DEV__) return;
  if (traces.size >= MAX_OPEN_TRACES) {
    const oldest = traces.keys().next().value;
    if (oldest !== undefined) traces.delete(oldest);
  }
  const now = Date.now();
  traces.set(id, { startedAt: now, last: now, stages: {} });
  console.log(`[perf] ${label} start id=${id}`);
}

export function perfMark(id: string, stage: string): void {
  if (!__DEV__) return;
  const t = traces.get(id);
  if (!t) return;
  const now = Date.now();
  // Since the previous stage, not since the start: the slow step is what
  // anyone reads these for, and cumulative numbers hide it behind
  // subtraction.
  t.stages[stage] = now - t.last;
  t.last = now;
}

export function perfEnd(id: string, label: string): void {
  if (!__DEV__) return;
  const t = traces.get(id);
  if (!t) return;
  traces.delete(id);
  const total = Date.now() - t.startedAt;
  console.log(`[perf] ${label} total=${total}ms`, t.stages);
}

/**
 * A one-shot stage for something with no natural start on this device —
 * a message ARRIVING. There is nothing to open a trace from, so this
 * opens and closes one around the work that follows the arrival.
 */
export function perfSpan(label: string, fn: () => void): void {
  if (!__DEV__) {
    fn();
    return;
  }
  const at = Date.now();
  fn();
  console.log(`[perf] ${label} ${Date.now() - at}ms`);
}
