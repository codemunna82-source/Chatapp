import { create } from 'zustand';
import { getJSON, setJSON } from '../storage/mmkv';

export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_PREFERENCE_KEY = 'voxo.themePreference';

interface ThemePreferenceState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

/**
 * Manual light/dark override, persisted across restarts. ThemeProvider
 * falls back to the OS scheme (useColorScheme()) whenever this is 'system'
 * — the default, and the only behavior before this store existed.
 */
export const useThemePreferenceStore = create<ThemePreferenceState>((set) => ({
  preference: getJSON<ThemePreference>(THEME_PREFERENCE_KEY) ?? 'system',
  setPreference: (preference) => {
    setJSON(THEME_PREFERENCE_KEY, preference);
    set({ preference });
  },
}));
