import { useCallback, useRef } from 'react';
import { storage } from '../storage/mmkv';

const KEY_PREFIX = 'voxo.draft.';

/**
 * Per-conversation draft text, persisted so a half-typed message survives
 * navigating away (or the app being backgrounded and killed).
 *
 * MMKV is synchronous and fast enough to write on every keystroke, but
 * there's no reason to: the write is debounced, and flushed explicitly when
 * the composer unmounts so nothing is lost on a fast back-navigation.
 */
export function useMessageDraft(conversationId: string) {
  const key = `${KEY_PREFIX}${conversationId}`;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);

  const read = useCallback(() => storage.getString(key) ?? '', [key]);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const value = pending.current;
    if (value === null) return;
    pending.current = null;
    if (value.trim()) {
      storage.set(key, value);
    } else {
      storage.delete(key);
    }
  }, [key]);

  const save = useCallback(
    (text: string) => {
      pending.current = text;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 400);
    },
    [flush],
  );

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pending.current = null;
    storage.delete(key);
  }, [key]);

  return { read, save, clear, flush };
}
