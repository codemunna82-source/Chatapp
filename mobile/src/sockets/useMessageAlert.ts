import { useCallback, useRef } from 'react';
import { Vibration } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useAlertPreferenceStore } from '../store/alertPreferenceStore';

/** Two short pulses — distinguishable from a call's long buzz without
 *  being a pattern anyone has to learn. */
const VIBRATION_PATTERN = [0, 60, 90, 60];

/** A burst of messages should make one sound, not five. */
const MIN_GAP_MS = 1500;

/**
 * Plays the in-app new-message alert.
 *
 * The player is created lazily and kept for the session rather than mounted
 * per component: this fires from a socket event, not from a render, and a
 * hook-bound player would be torn down and rebuilt on every screen change.
 */
export function useMessageAlert(): () => void {
  const playerRef = useRef<AudioPlayer | null>(null);
  const lastAlertAt = useRef(0);

  return useCallback(() => {
    const now = Date.now();
    if (now - lastAlertAt.current < MIN_GAP_MS) return;
    lastAlertAt.current = now;

    const { sound, vibrate } = useAlertPreferenceStore.getState();

    if (vibrate) {
      Vibration.vibrate(VIBRATION_PATTERN);
    }

    if (!sound) return;
    try {
      if (!playerRef.current) {
        // playsInSilentMode false: a phone switched to silent should stay
        // silent. That is the user's explicit instruction to the device and
        // outranks this app's preference toggle.
        void setAudioModeAsync({ playsInSilentMode: false });
        playerRef.current = createAudioPlayer(require('../../assets/notification.wav'));
        playerRef.current.volume = 0.6;
      }
      playerRef.current.seekTo(0);
      playerRef.current.play();
    } catch {
      // A failed chime must never take down the socket handler that called
      // it — the message itself has already been delivered to the cache.
    }
  }, []);
}
