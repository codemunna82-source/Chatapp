import { create } from 'zustand';
import { getJSON, setJSON } from '../storage/mmkv';

const RECENT_EMOJI_KEY = 'voxo.recentEmoji';
const MAX_RECENT = 24;

interface RecentEmojiState {
  recents: string[];
  addRecent: (char: string) => void;
}

/** Persisted "Recently used" row for the emoji picker — most-recent first, capped and de-duplicated. */
export const useRecentEmojiStore = create<RecentEmojiState>((set, get) => ({
  recents: getJSON<string[]>(RECENT_EMOJI_KEY) ?? [],
  addRecent: (char) => {
    const next = [char, ...get().recents.filter((c) => c !== char)].slice(0, MAX_RECENT);
    setJSON(RECENT_EMOJI_KEY, next);
    set({ recents: next });
  },
}));
