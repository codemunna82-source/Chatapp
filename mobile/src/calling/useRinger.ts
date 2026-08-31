import { useEffect } from 'react';
import { Vibration } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useAlertPreferenceStore } from '../store/alertPreferenceStore';

/**
 * The ring — sound and vibration — while a call is waiting to be answered.
 *
 * Deliberately separate from useMessageAlert: a message chimes once and is
 * done, a ring has to keep going until someone acts on it, and the two
 * have opposite stopping conditions.
 */

/** Ring, pause, ring — the pattern repeats until the call is dealt with. */
const VIBRATION_PATTERN = [0, 700, 900];

let player: AudioPlayer | null = null;

function startSound(): void {
  try {
    // Unlike the message chime, this one deliberately does NOT force
    // playsInSilentMode: a phone on silent should not start ringing out
    // loud. The vibration below is what reaches the user there.
    void setAudioModeAsync({ playsInSilentMode: false });
    if (!player) {
      player = createAudioPlayer(require('../../assets/ringtone.wav'));
      // The file already carries its own trailing silence, so looping it
      // produces a repeating ring rather than a continuous tone.
      player.loop = true;
      player.volume = 0.7;
    }
    player.seekTo(0);
    player.play();
  } catch {
    // No audio route, or the file failed to load. The vibration and the
    // on-screen call are the parts that actually matter.
  }
}

function stopSound(): void {
  try {
    player?.pause();
  } catch {
    // Already gone.
  }
}

/**
 * Rings for as long as `active` stays true.
 *
 * Everything it starts is stopped in the cleanup, so a call answered,
 * declined, or cancelled by the customer all silence the phone through the
 * same path — there is no state in which the ring can outlive the call.
 */
export function useRinger(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const { sound, vibrate } = useAlertPreferenceStore.getState();
    if (sound) startSound();
    if (vibrate) Vibration.vibrate(VIBRATION_PATTERN, true);

    return () => {
      stopSound();
      Vibration.cancel();
    };
  }, [active]);
}
