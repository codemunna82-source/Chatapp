import { getJSON, setJSON } from '../storage/mmkv';

/**
 * Calls this phone has already finished with, so a late push cannot
 * start them ringing again.
 *
 * The bug this exists for: a call push arrives, the phone rings, the user
 * declines — and then a SECOND copy of the same push lands. FCM retries,
 * and a call is announced over both the socket and a push precisely so
 * that one arriving late still gets through. Nothing said the call was
 * over, so the notification went up again, with `ongoing: true` and
 * `loopSound: true` — and rang until it timed out, on a call the user had
 * already declined.
 *
 * Neither of the two places that draw the notification could tell on its
 * own. The foreground one checked the call store, which a decline has
 * already reset to idle; the background one runs in a fresh module graph
 * with no store at all. So this is written to device storage rather than
 * held in memory — the background handler has to be able to read what the
 * foreground wrote a second earlier, across process boundaries.
 */

const KEY = 'voxo.endedCalls';

/**
 * How long an id stays remembered.
 *
 * Comfortably longer than a ring can last (RING_TIMEOUT_MS is a minute),
 * because the window that matters is how late a duplicate push can arrive
 * rather than how long the call was — FCM will retry a delivery for some
 * minutes. Ten is cheap: each entry is an id and a timestamp.
 */
const TTL_MS = 10 * 60 * 1000;

/**
 * How many are kept.
 *
 * Bounded because this is device storage that nothing else prunes. Fifty
 * is far more than the calls one phone can have in a TTL window, and the
 * oldest are dropped first.
 */
const MAX_ENTRIES = 50;

interface EndedCall {
  id: string;
  at: number;
}

function read(): EndedCall[] {
  const stored = getJSON<EndedCall[]>(KEY);
  if (!Array.isArray(stored)) return [];
  const cutoff = Date.now() - TTL_MS;
  // Pruned on read rather than on a timer: there is no process alive
  // between a decline and the duplicate push it is guarding against.
  return stored.filter((e) => e && typeof e.id === 'string' && e.at > cutoff);
}

/** This call is over — however it ended. */
export function markCallEnded(callId: string): void {
  if (!callId) return;
  try {
    const kept = read().filter((e) => e.id !== callId);
    kept.push({ id: callId, at: Date.now() });
    setJSON<EndedCall[]>(KEY, kept.slice(-MAX_ENTRIES));
  } catch {
    // Storage unavailable. The ring is the thing that still works; losing
    // this only means a duplicate push could ring again, which is where
    // we were before.
  }
}

/** Whether this call has already been dealt with on this phone. */
export function wasCallEnded(callId: string): boolean {
  if (!callId) return false;
  try {
    return read().some((e) => e.id === callId);
  } catch {
    // Unreadable storage must not stop a real call ringing.
    return false;
  }
}

/** Test seam. */
export function forgetEndedCalls(): void {
  try {
    setJSON<EndedCall[]>(KEY, []);
  } catch {
    // Nothing to do.
  }
}
