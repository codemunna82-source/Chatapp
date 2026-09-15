import { create } from 'zustand';
import { getJSON, setJSON } from '../storage/mmkv';
import { DEFAULT_RINGTONE_ID, ringtoneById, type Ringtone } from '../calling/ringtones';

const RINGTONE_KEY = 'voxo.callRingtone';

interface RingtoneState {
  ringtoneId: string;
  setRingtoneId: (id: string) => void;
}

/**
 * Which ringtone this phone uses for an incoming call.
 *
 * Per-device (MMKV) rather than a workspace setting, for the same reason
 * the sound and vibration switches beside it are: what a phone sounds
 * like belongs to the person holding it, not to the account.
 */
export const useRingtoneStore = create<RingtoneState>((set) => ({
  ringtoneId: getJSON<string>(RINGTONE_KEY) ?? DEFAULT_RINGTONE_ID,
  setRingtoneId: (id) => {
    setJSON(RINGTONE_KEY, id);
    set({ ringtoneId: id });
  },
}));

/** The chosen ringtone, resolved. Safe to call outside React. */
export function currentRingtone(): Ringtone {
  return ringtoneById(useRingtoneStore.getState().ringtoneId);
}
