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
 * it, so it used to resolve once to whatever the OS was set to — but a
 * first install on a phone already in dark mode then opened looking
 * nothing like the rest of VOXO's screens, which stay light by default.
 * Light is now the fixed fallback for anyone with no stored choice at
 * all, same as every other screen; the OS setting still has zero say in
 * it, deliberately — this is an explicit, persisted choice, not a
 * follow-the-system mode.
 */
function initialPreference(): ThemePreference {
  const stored = getJSON<string>(THEME_PREFERENCE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'light';
}

/** Explicit light/dark choice, persisted across restarts. */
export const useThemePreferenceStore = create<ThemePreferenceState>((set) => ({
  preference: initialPreference(),
  setPreference: (preference) => {
    setJSON(THEME_PREFERENCE_KEY, preference);
    set({ preference });
  },
}));
