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
 * Players are module-level, not per-hook.
 *
 * Both sounds fire from callbacks (a socket event, a send completing), not
 * from a render, and a hook-bound player would be torn down and rebuilt on
 * every screen change — leaving the first sound after each navigation to
 * miss while the file loaded.
 */
let incomingPlayer: AudioPlayer | null = null;
let sentPlayer: AudioPlayer | null = null;
let audioModeSet = false;

function play(which: 'incoming' | 'sent'): void {
  try {
    if (!audioModeSet) {
      // playsInSilentMode false: a phone switched to silent should stay
      // silent. That is the user's explicit instruction to the device and
      // outranks this app's preference toggle.
      void setAudioModeAsync({ playsInSilentMode: false });
      audioModeSet = true;
    }
    if (which === 'incoming') {
      if (!incomingPlayer) {
        incomingPlayer = createAudioPlayer(require('../../assets/notification.wav'));
        incomingPlayer.volume = 0.6;
      }
      incomingPlayer.seekTo(0);
      incomingPlayer.play();
    } else {
      if (!sentPlayer) {
        sentPlayer = createAudioPlayer(require('../../assets/sent.wav'));
        // Quieter than the incoming chime: confirming your own action
        // should register without asking for attention.
        sentPlayer.volume = 0.35;
      }
      sentPlayer.seekTo(0);
      sentPlayer.play();
    }
  } catch {
    // A failed sound must never take down the caller — the message it was
    // announcing has already been delivered or sent.
  }
}

/** Plays the in-app new-message alert (sound + vibration, per Settings). */
export function useMessageAlert(): () => void {
  const lastAlertAt = useRef(0);

  return useCallback(() => {
    const now = Date.now();
    if (now - lastAlertAt.current < MIN_GAP_MS) return;
    lastAlertAt.current = now;

    const { sound, vibrate } = useAlertPreferenceStore.getState();
    if (vibrate) {
      Vibration.vibrate(VIBRATION_PATTERN);
    }
    if (sound) play('incoming');
  }, []);
}

/**
 * The outgoing counterpart, played when a send succeeds.
 *
 * No vibration and no rate limit: this answers a deliberate action the user
 * just took, one sound per send is exactly right, and buzzing the phone in
 * your own hand for your own tap is noise. It shares the Settings sound
 * toggle — someone who silenced the app silenced all of it.
 */
export function playSentSound(): void {
  if (!useAlertPreferenceStore.getState().sound) return;
  play('sent');
}
