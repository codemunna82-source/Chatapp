import { MMKV } from 'react-native-mmkv';

/**
 * Fast key-value store for non-sensitive UI state only (theme preference,
 * collapsed sections, draft text, cached list scroll position, etc.).
 * Auth tokens must never go here — see secureStorage.ts.
 */
export const storage = new MMKV({ id: 'voxo-app-storage' });

export function getJSON<T>(key: string): T | null {
  const raw = storage.getString(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setJSON<T>(key: string, value: T): void {
  storage.set(key, JSON.stringify(value));
}

export function remove(key: string): void {
  storage.delete(key);
}
