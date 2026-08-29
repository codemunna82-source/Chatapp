import { create } from 'zustand';
import { getJSON, setJSON } from '../storage/mmkv';

const SOUND_KEY = 'voxo.alertSound';
const VIBRATE_KEY = 'voxo.alertVibrate';

interface AlertPreferenceState {
  sound: boolean;
  vibrate: boolean;
  setSound: (on: boolean) => void;
  setVibrate: (on: boolean) => void;
}

function initialBool(key: string, fallback: boolean): boolean {
  const stored = getJSON<boolean>(key);
  return typeof stored === 'boolean' ? stored : fallback;
}

/**
 * In-app alerts for incoming messages. Both default on, because the point
 * of this app is not missing a customer — but both are switchable, since a
 * busy inbox in a quiet room is exactly where a chime stops being helpful.
 *
 * Per-device (MMKV), not a tenant setting: whether a phone should make a
 * noise is a property of the phone and the room it is in.
 */
export const useAlertPreferenceStore = create<AlertPreferenceState>((set) => ({
  sound: initialBool(SOUND_KEY, true),
  vibrate: initialBool(VIBRATE_KEY, true),
  setSound: (on) => {
    setJSON(SOUND_KEY, on);
    set({ sound: on });
  },
  setVibrate: (on) => {
    setJSON(VIBRATE_KEY, on);
    set({ vibrate: on });
  },
}));
