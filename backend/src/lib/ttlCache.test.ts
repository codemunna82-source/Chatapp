import { createTtlCache } from './ttlCache';

describe('createTtlCache', () => {
  it('returns a stored value before it expires and forgets it after', () => {
    jest.useFakeTimers();
    try {
      const cache = createTtlCache<number>({ ttlMs: 1000, maxEntries: 10 });
      cache.set('a', 1);

      jest.advanceTimersByTime(999);
      expect(cache.get('a')).toBe(1);

      jest.advanceTimersByTime(2);
      expect(cache.get('a')).toBeUndefined();
      // Reading an expired entry drops it rather than leaving it to
      // accumulate for keys that are never read again.
      expect(cache.size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('evicts the oldest entry at the cap instead of growing', () => {
    const cache = createTtlCache<string>({ ttlMs: 60_000, maxEntries: 3 });
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.set('c', 'C');
    cache.set('d', 'D');

    expect(cache.size).toBe(3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('d')).toBe('D');
  });

  it('treats a re-set key as newly inserted for eviction order', () => {
    const cache = createTtlCache<string>({ ttlMs: 60_000, maxEntries: 2 });
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.set('a', 'A2'); // 'a' is now the newer of the two
    cache.set('c', 'C');

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('A2');
    expect(cache.get('c')).toBe('C');
  });

  it('drops a key on delete', () => {
    const cache = createTtlCache<number>({ ttlMs: 60_000, maxEntries: 5 });
    cache.set('a', 1);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
  });
});
