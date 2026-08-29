export interface TtlCacheOptions {
  ttlMs: number;
  /**
   * Hard cap on entries. This is a multi-tenant process, so an unbounded
   * map keyed by tenant or user is a slow memory leak — the oldest entry
   * is evicted once the cap is reached.
   */
  maxEntries: number;
}

export interface TtlCache<T> {
  get: (key: string) => T | undefined;
  set: (key: string, value: T) => void;
  delete: (key: string) => void;
  clear: () => void;
  readonly size: number;
}

/**
 * A small in-process cache with a time-to-live.
 *
 * In-process, not Redis, on purpose: the things cached with it (an auth
 * context, a dashboard rollup) are cheap to recompute and are read far more
 * often than they change, so the win is in skipping a database round trip —
 * and a network hop to Redis would give most of that back. The cost is that
 * each instance of a horizontally scaled deployment keeps its own copy, so
 * a value can be up to `ttlMs` stale on one instance while already updated
 * on another. Only use it where that is acceptable and say why at the call
 * site.
 *
 * Eviction is lazy (on read) plus a bounded insert, so there is no timer
 * holding the process open.
 */
export function createTtlCache<T>(options: TtlCacheOptions): TtlCache<T> {
  const entries = new Map<string, { value: T; expiresAt: number }>();

  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt <= Date.now()) {
        entries.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value) {
      // Re-inserting moves the key to the end of the Map's insertion
      // order, which is what makes the eviction below oldest-first.
      entries.delete(key);
      if (entries.size >= options.maxEntries) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
      entries.set(key, { value, expiresAt: Date.now() + options.ttlMs });
    },
    delete(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
