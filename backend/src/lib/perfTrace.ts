import { env } from '../config/env';
import { logger } from './logger';

/**
 * Where a realtime message's milliseconds actually went.
 *
 * Written after a reply was found to take 2.1 s to leave the server on a
 * socket that delivers in single-digit milliseconds. Nothing in the logs
 * could have told us that: a request log gives one total, which is the
 * one number that cannot say whether the time was spent in Node, in
 * Mongo, or on the wire to Mongo. The answer turned out to be eight
 * database round trips standing in single file, and the only reason we
 * know is that the stages were timed separately.
 *
 * Deliberately not a metrics library, an APM agent or a tracing
 * exporter. This has one job — tell the stages apart on one machine's
 * clock — and every one of those costs a dependency, an endpoint and a
 * background flush to answer a question a log line already answers.
 *
 * OFF unless PERF_TRACE=true. When off, `trace()` returns a shared
 * do-nothing object, so an instrumented path costs one property read per
 * stage and allocates nothing. Turn it on in Render's environment when
 * you want the numbers, and off again when you have them — leaving it on
 * writes a line per message, which is noise on a busy day.
 */
export interface PerfTrace {
  /** Records that a stage finished, now. */
  mark(stage: string): void;
  /** Writes the whole sequence as one line and ends the trace. */
  end(extra?: Record<string, unknown>): void;
}

const NOOP: PerfTrace = { mark: () => {}, end: () => {} };

/**
 * One line per traced operation rather than one per stage.
 *
 * Stages interleave across concurrent requests, so per-stage lines would
 * have to be correlated by hand before they meant anything. A single
 * object with every delta on it is readable as it stands, and sorts and
 * filters as a unit.
 */
export function trace(name: string, context: Record<string, unknown> = {}): PerfTrace {
  if (!env.PERF_TRACE) return NOOP;

  // Monotonic, so an NTP correction mid-request cannot produce a negative
  // stage. Date.now() would, and a negative millisecond count in a
  // performance log is worse than no log — it gets explained away.
  const startedAt = process.hrtime.bigint();
  let previous = startedAt;
  const stages: Record<string, number> = {};

  const sinceMs = (from: bigint): number => Number((process.hrtime.bigint() - from) / 1_000n) / 1_000;

  return {
    mark(stage: string) {
      const now = process.hrtime.bigint();
      // The delta since the PREVIOUS stage, not since the start. Cumulative
      // numbers make you subtract in your head to find the slow step,
      // which is the only thing anyone reads these for.
      stages[stage] = Number((now - previous) / 1_000n) / 1_000;
      previous = now;
    },
    end(extra: Record<string, unknown> = {}) {
      logger.info(
        { perf: name, ...context, ...extra, stages, totalMs: sinceMs(startedAt) },
        `perf ${name}`,
      );
    },
  };
}
