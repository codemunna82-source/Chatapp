/**
 * MMKV is native, so the store is stubbed with a plain map. What is under
 * test is the remembering, not the storage engine.
 */
const mockStore = new Map<string, string>();
jest.mock('../storage/mmkv', () => ({
  getJSON: <T,>(key: string): T | null => {
    const raw = mockStore.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  },
  setJSON: <T,>(key: string, value: T): void => {
    mockStore.set(key, JSON.stringify(value));
  },
  remove: (key: string): void => {
    mockStore.delete(key);
  },
}));

// jest.mock is hoisted above imports, so the module under test must be
// imported after it or it binds the real, native MMKV.
// eslint-disable-next-line import/first
import { markCallEnded, wasCallEnded, forgetEndedCalls } from './endedCalls';

/**
 * The bug: decline a call, a duplicate push lands, and the phone rings
 * again on a call the user already dealt with — looping and ongoing,
 * until it timed out a minute later.
 */
describe('endedCalls', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.useRealTimers();
  });

  it('remembers a call that was dealt with', () => {
    expect(wasCallEnded('call-1')).toBe(false);
    markCallEnded('call-1');
    expect(wasCallEnded('call-1')).toBe(true);
  });

  it('does not silence a different call', () => {
    markCallEnded('call-1');
    expect(wasCallEnded('call-2')).toBe(false);
  });

  it('survives a fresh read, which is the whole point', () => {
    // The background push handler runs in its own module graph and has to
    // see what the foreground wrote a second earlier.
    markCallEnded('call-1');
    jest.resetModules();
    // A static import is resolved once; re-reading the module after
    // resetModules is the only way to reproduce the background handler's
    // fresh module graph, which is exactly what this asserts.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const reloaded = require('./endedCalls') as typeof import('./endedCalls');
    expect(reloaded.wasCallEnded('call-1')).toBe(true);
  });

  it('forgets an id once it is too old to be a duplicate', () => {
    jest.useFakeTimers();
    markCallEnded('call-1');
    expect(wasCallEnded('call-1')).toBe(true);
    jest.advanceTimersByTime(11 * 60 * 1000);
    expect(wasCallEnded('call-1')).toBe(false);
  });

  it('keeps the list bounded, dropping the oldest', () => {
    for (let i = 0; i < 60; i += 1) markCallEnded(`call-${i}`);
    expect(wasCallEnded('call-0')).toBe(false);
    expect(wasCallEnded('call-59')).toBe(true);
    expect(wasCallEnded('call-58')).toBe(true);
  });

  it('re-marking moves an id to the newest rather than duplicating it', () => {
    markCallEnded('call-1');
    markCallEnded('call-1');
    for (let i = 0; i < 49; i += 1) markCallEnded(`other-${i}`);
    // Still remembered: one entry was kept, not two spending two slots.
    expect(wasCallEnded('call-1')).toBe(true);
  });

  it('ignores an empty id rather than remembering one', () => {
    markCallEnded('');
    expect(wasCallEnded('')).toBe(false);
  });

  it('can be cleared', () => {
    markCallEnded('call-1');
    forgetEndedCalls();
    expect(wasCallEnded('call-1')).toBe(false);
  });
});
