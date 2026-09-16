import { useEffect } from 'react';
import { Vibration } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useAlertPreferenceStore } from '../store/alertPreferenceStore';
import { currentRingtone } from '../store/ringtoneStore';
import { customSoundUri } from './customRingtone';
import { cancelIncomingCall } from './callNotification';
import { useCallStore } from './callStore';

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
/**
 * Which ring is current.
 *
 * Bumped on every start AND every stop, so an asynchronous lookup that
 * resolves late can tell whether the ring it was fetching a sound for is
 * still wanted. Without it, declining a call during the custom sound's
 * native round trip let the lookup finish afterwards and start a looping
 * player that nothing was left to stop — the phone rang on, with the call
 * already gone.
 */
let ringGeneration = 0;
/** What `player` holds — the ringtone id, or the custom sound's URI, so a
 *  changed choice rebuilds it and an unchanged one does not. */
let loadedSource: string | null = null;

/**
 * Builds the player for a source and starts it.
 *
 * Split out because the custom sound has to be looked up asynchronously
 * (Android reports it on the channel) while a bundled one is a require()
 * that is already in hand — and the ring must not wait on the lookup in
 * the common case.
 */
function play(source: number | string, key: string): void {
  // Rebuilt only when the choice changed. A player holds a decoded file,
  // and creating one per call would leak nine of them through an
  // afternoon of picking ringtones in Settings.
  if (!player || loadedSource !== key) {
    player?.remove();
    player = createAudioPlayer(typeof source === 'string' ? { uri: source } : source);
    // Every bundled file carries its own trailing silence, so looping
    // produces a repeating ring rather than one unbroken tone. A sound
    // the user chose has whatever shape it has; looping it is still
    // closer to ringing than playing it once.
    player.loop = true;
    player.volume = 0.7;
    loadedSource = key;
  }
  player.seekTo(0);
  player.play();
}

function startSound(): void {
  const generation = ++ringGeneration;
  try {
    // Unlike the message chime, this one deliberately does NOT force
    // playsInSilentMode: a phone on silent should not start ringing out
    // loud. The vibration below is what reaches the user there.
    void setAudioModeAsync({ playsInSilentMode: false });
    const ringtone = currentRingtone();

    if (ringtone.asset !== undefined) {
      play(ringtone.asset, ringtone.id);
      return;
    }

    /**
     * The sound the user chose in Android's own settings.
     *
     * Asked for rather than stored, because they can change it there at
     * any time without this app being involved. The lookup is a native
     * round trip, so the ring starts a beat late — acceptable for the one
     * option whose whole point is that it is not ours, and the vibration
     * and the call screen are already up by then.
     */
    void customSoundUri()
      .then((uri) => {
        // Only if this is still the ring that asked for it.
        if (uri && generation === ringGeneration) play(uri, uri);
      })
      .catch(() => {
        // No channel, or a sound that will not open. The vibration and
        // the on-screen call are the parts that actually matter.
      });
  } catch {
    // No audio route, or the file failed to load. The vibration and the
    // on-screen call are the parts that actually matter.
  }
}

function stopSound(): void {
  // First, and outside the try: a lookup still in flight must be
  // invalidated even if pausing throws.
  ringGeneration++;
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

    /** The call this ring belongs to, captured now: by cleanup time the
     *  store has already been reset to idle and the id is gone. */
    const callId = useCallStore.getState().callId;

    return () => {
      stopSound();
      Vibration.cancel();
      // Answered, declined, cancelled or timed out — every way a ring
      // ends comes through here, which makes it the one place that can
      // promise the notification never outlives the call.
      if (callId) void cancelIncomingCall(callId);
    };
  }, [active]);
}
