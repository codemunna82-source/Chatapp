const DAY_MS = 24 * 60 * 60 * 1000;

/** Compact relative time for the chat list — WhatsApp-style ("2:45 PM", "Yesterday", "Mon", or a short date). */
export function formatChatListTime(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysAgo = Math.round((startOfToday.getTime() - startOfDate.getTime()) / DAY_MS);

  if (daysAgo === 0) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (daysAgo === 1) return 'Yesterday';
  if (daysAgo > 1 && daysAgo < 7) {
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Full time for a message bubble's timestamp. */
export function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Date-separator label ("Today", "Yesterday", or a full date). */
export function formatDateSeparator(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysAgo = Math.round((startOfToday.getTime() - startOfDate.getTime()) / DAY_MS);

  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

/** Elapsed-time readout for voice recording/playback — "0:07", "1:03". */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** YYYY-MM-DD in local time — used to group messages by day for date separators. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * How much of Meta's 24-hour customer-service window is left, as a short
 * label ("18h left", "45m left"), or null once it has closed or was never
 * opened. Deliberately coarse: the exact second does not change what the
 * user should do, and a ticking countdown would re-render the header every
 * second for no benefit.
 */
export function formatWindowRemaining(expiresAtIso: string | undefined): string | null {
  if (!expiresAtIso) return null;
  const msLeft = new Date(expiresAtIso).getTime() - Date.now();
  if (!Number.isFinite(msLeft) || msLeft <= 0) return null;

  const minutes = Math.floor(msLeft / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m left`;
  return `${Math.floor(minutes / 60)}h left`;
}
