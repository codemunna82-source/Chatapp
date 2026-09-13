import { create } from 'zustand';
import { getJSON, setJSON } from '../storage/mmkv';

const KEY = 'voxo.callsSeenAt';

interface CallsSeenState {
  /** ISO timestamp of the last time the Calls tab was opened, or null. */
  seenAt: string | null;
  markSeen: () => void;
}

/**
 * When the user last looked at the Calls tab.
 *
 * A missed-call badge needs somewhere to stop counting, and calls have no
 * read state on the server — a badge counting every MISSED call ever
 * recorded would only ever grow, which is worse than no badge at all.
 * WhatsApp answers this the same way: the badge counts what arrived since
 * you last opened the tab, and opening it clears the badge.
 *
 * Per-device (MMKV) rather than a tenant setting, for the same reason the
 * alert preferences are: "have I looked at this yet" is a property of the
 * phone in someone's hand, not of the workspace.
 */
export const useCallsSeenStore = create<CallsSeenState>((set) => ({
  seenAt: getJSON<string>(KEY) ?? null,
  markSeen: () => {
    const now = new Date().toISOString();
    setJSON(KEY, now);
    set({ seenAt: now });
  },
}));
