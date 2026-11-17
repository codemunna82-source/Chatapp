import { Appearance } from 'react-native';
import { create } from 'zustand';
import { getJSON, setJSON } from '../storage/mmkv';

export type ThemePreference = 'light' | 'dark';

const THEME_PREFERENCE_KEY = 'voxo.themePreference';

interface ThemePreferenceState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

/**
 * Reads the stored choice, migrating anything that isn't a valid preference.
 *
 * 'system' used to be an option and is still on disk for anyone who picked
 * it, so it resolves once to whatever the OS is currently set to and is then
 * treated as an explicit choice — the appearance setting is now Light or
 * Dark only, with no follow-the-system mode.
 */
function initialPreference(): ThemePreference {
  const stored = getJSON<string>(THEME_PREFERENCE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

/** Explicit light/dark choice, persisted across restarts. */
export const useThemePreferenceStore = create<ThemePreferenceState>((set) => ({
  preference: initialPreference(),
  setPreference: (preference) => {
    setJSON(THEME_PREFERENCE_KEY, preference);
    set({ preference });
  },
}));
