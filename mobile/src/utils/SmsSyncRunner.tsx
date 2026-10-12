import { useEffect } from 'react';
import { AppState } from 'react-native';
import { syncLocalSmsToBackend } from './smsSync';

/**
 * How often this re-scans while the app sits in the foreground. Does not
 * need to be as tight as SmsThreadScreen's own 4-second UI poll (that one
 * is reading data already on the device to paint a screen someone is
 * looking at right now) — this is pushing it to the backend for other
 * devices and for persistence, where half a minute of lag is unnoticed.
 */
const SYNC_INTERVAL_MS = 30_000;

/**
 * No UI — mounted alongside the other signed-in-only background runners
 * in RootNavigator (see OutboxFlusher for the same shape). Syncs on
 * mount, on an interval while the app stays in the foreground, and again
 * whenever the app returns to the front: there is no OS push telling
 * this app "go sync your SMS" the way RealtimeSync has a socket event —
 * an SMS arriving is a broadcast only Android itself sees.
 *
 * Android only and a no-op everywhere else — see syncLocalSmsToBackend.
 */
export function SmsSyncRunner(): null {
  useEffect(() => {
    void syncLocalSmsToBackend();
    const interval = setInterval(() => void syncLocalSmsToBackend(), SYNC_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncLocalSmsToBackend();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);

  return null;
}
