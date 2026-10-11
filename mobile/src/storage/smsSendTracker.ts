import { getJSON, setJSON } from './mmkv';

/**
 * How many invitation SMS VOXO itself has auto-sent today, from this
 * device's own SIM. This is the only "SMS count" VOXO can honestly show:
 * Android has no API for a carrier's SMS-pack/bundle balance (that lives
 * behind the operator's own app or a USSD code), so this tracks VOXO's own
 * sends rather than claiming to know what the SIM has left.
 */
const STORAGE_KEY = 'voxo.smsSentToday';

interface SentCounter {
  date: string;
  count: number;
}

// Device-local date, not UTC — a send at 11pm IST and a check at 1am IST
// are still "today" and "today" to someone reading the count on their own
// phone; toISOString() would roll the boundary to 5:30am IST instead and
// disagree with VoxoSmsAutoReplyModule's own todayKey() (Kotlin's
// SimpleDateFormat defaults to the device's local timezone).
function todayKey(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export function recordSmsSent(): number {
  const today = todayKey();
  const existing = getJSON<SentCounter>(STORAGE_KEY);
  const count = existing && existing.date === today ? existing.count + 1 : 1;
  setJSON<SentCounter>(STORAGE_KEY, { date: today, count });
  return count;
}

export function getSmsSentToday(): number {
  const existing = getJSON<SentCounter>(STORAGE_KEY);
  if (!existing || existing.date !== todayKey()) return 0;
  return existing.count;
}
