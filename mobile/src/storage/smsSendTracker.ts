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

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
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
