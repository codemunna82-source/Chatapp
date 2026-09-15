import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';
import { RINGTONES, ringtoneById, type Ringtone } from '../../calling/ringtones';
import { useRingtoneStore } from '../../store/ringtoneStore';
import { applyRingtoneChannel, registerForPushNotifications } from '../../notifications/pushRegistration';

/**
 * Picking the ringtone a call arrives with.
 *
 * Every tap plays the sound. A list of names is not a choice anyone can
 * make — "Marimba" and "Chime" mean nothing until you have heard them,
 * and a ringtone chosen blind is one discovered at the worst moment.
 *
 * Once played, the sound is also SAVED. There is no separate confirm: the
 * thing you just heard is the thing you will hear, which is the whole of
 * what this screen has to say.
 */
export function RingtoneSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors, spacing, radius, typography } = useTheme();
  const ringtoneId = useRingtoneStore((s) => s.ringtoneId);
  const setRingtoneId = useRingtoneStore((s) => s.setRingtoneId);
  const [playing, setPlaying] = useState<string | null>(null);

  /**
   * One player, replaced per preview and released on close.
   *
   * A player holds a decoded file; creating one per tap and leaving it
   * would keep all eight in memory after a minute of browsing.
   */
  const playerRef = useRef<AudioPlayer | null>(null);
  const release = useCallback(() => {
    try {
      playerRef.current?.remove();
    } catch {
      // Already gone.
    }
    playerRef.current = null;
    setPlaying(null);
  }, []);

  useEffect(() => release, [release]);

  /**
   * Closing silences the preview.
   *
   * Done on the close PATHS rather than by watching `visible`: reacting to
   * the prop meant setting state straight from an effect body, which costs
   * a second render of the whole list every time the sheet opens. Every
   * way out of here — the ×, the scrim, the back button — comes through
   * this, and unmounting is covered by the cleanup above.
   */
  const close = useCallback(() => {
    release();
    onClose();
  }, [release, onClose]);

  const choose = useCallback(
    (ringtone: Ringtone) => {
      setRingtoneId(ringtone.id);

      release();
      try {
        // Previews play even on silent: someone comparing ringtones has
        // deliberately asked to hear them, unlike a call arriving on its
        // own — which useRinger keeps quiet on a silenced phone.
        void setAudioModeAsync({ playsInSilentMode: true });
        const player = createAudioPlayer(ringtone.asset);
        player.volume = 0.8;
        playerRef.current = player;
        setPlaying(ringtone.id);
        player.play();
      } catch {
        // No audio route. The choice is still saved, which is the part
        // that matters.
      }

      /**
       * Android hears this through a CHANNEL, and the channel is where the
       * sound lives — so the choice is not made until the channel exists
       * and the server has been told which one to ring.
       *
       * Not awaited: the tap should feel instant, and both steps are
       * self-correcting. The channel is re-applied at every launch, and
       * registration retries whenever the app comes back to the front.
       */
      void applyRingtoneChannel(ringtone)
        .then(() => registerForPushNotifications())
        .catch(() => {
          // See above — the next launch picks it up.
        });
    },
    [setRingtoneId, release],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={[styles.scrim, { backgroundColor: colors.overlay }]} onPress={close} />

      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surfaceElevated,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            paddingBottom: spacing.lg,
          },
        ]}
      >
        <View style={[styles.header, { paddingHorizontal: spacing.md, paddingVertical: spacing.sm }]}>
          <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>Call ringtone</Text>
          <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            {({ pressed }) => (
              <Ionicons name="close" size={22} color={colors.textSecondary} style={{ opacity: pressed ? 0.5 : 1 }} />
            )}
          </Pressable>
        </View>

        <Text
          style={[
            typography.caption,
            { color: colors.textSecondary, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
          ]}
        >
          Tap one to hear it. It is saved as you listen.
        </Text>

        <ScrollView style={styles.listScroll} showsVerticalScrollIndicator={false}>
          {RINGTONES.map((ringtone) => {
            const selected = ringtone.id === ringtoneId;
            return (
              <Pressable
                key={ringtone.id}
                onPress={() => choose(ringtone)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${ringtone.label} ringtone`}
                style={({ pressed }) => [
                  styles.row,
                  {
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
                  },
                ]}
              >
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={selected ? colors.success : colors.textTertiary}
                />
                <Text
                  style={[
                    selected ? typography.bodyMedium : typography.body,
                    { color: colors.textPrimary, marginLeft: spacing.md, flex: 1 },
                  ]}
                >
                  {ringtone.label}
                </Text>
                {playing === ringtone.id ? (
                  <Ionicons name="volume-high" size={18} color={colors.success} />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** The label for the Settings row, so the screen never hard-codes a name
 *  that could drift from the list. */
export function ringtoneLabel(id: string): string {
  return ringtoneById(id).label;
}

const styles = StyleSheet.create({
  scrim: { flex: 1 },
  sheet: { maxHeight: '62%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listScroll: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: touchTarget.compact },
});
