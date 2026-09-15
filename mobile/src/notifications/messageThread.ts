import { getJSON, setJSON, remove } from '../storage/mmkv';

/**
 * The last few messages of each conversation that has a notification up.
 *
 * MessagingStyle draws a thread, not a line — three messages from one
 * customer should read as three messages, the way a phone shows them,
 * rather than as the third one replacing the second. Android keeps none
 * of that for us: every notification is built from scratch, and a
 * background task that has just been woken remembers nothing at all. So
 * the thread is kept here.
 *
 * MMKV rather than memory for exactly that reason — the process that
 * draws the second message is very often not the one that drew the first.
 *
 * Cleared when the notification goes away: read, dismissed, or the chat
 * opened. A thread that outlives its notification would reappear
 * underneath tomorrow's first message.
 */

export interface ThreadEntry {
  text: string;
  /** Milliseconds. The server's send time, so a delayed delivery does not
   *  claim to have arrived just now. */
  at: number;
  /**
   * Sent by this workspace rather than by the customer — a reply typed
   * into the notification itself.
   *
   * Rendered with no `person`, which is how Android's MessagingStyle is
   * told a line is from the reader: it draws it on the other side,
   * without the sender's face, exactly as a phone does.
   */
  mine?: boolean;
}

/**
 * How many lines the notification remembers.
 *
 * Android shows about this many in an expanded MessagingStyle anyway, and
 * the point of the cap is not the display — it is that this is written on
 * every incoming message, and an unbounded array in device storage grows
 * for as long as a conversation does.
 */
const MAX_ENTRIES = 6;

function key(conversationId: string): string {
  return `voxo.msgthread.${conversationId}`;
}

/** Appends one line and returns the whole thread, newest last. */
export function rememberMessage(conversationId: string, entry: ThreadEntry): ThreadEntry[] {
  const existing = getJSON<ThreadEntry[]>(key(conversationId)) ?? [];
  const next = [...existing, entry].slice(-MAX_ENTRIES);
  setJSON(key(conversationId), next);
  return next;
}

export function forgetThread(conversationId: string): void {
  remove(key(conversationId));
}
