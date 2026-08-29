import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { mediaUrl } from '../../api/endpoints/media';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';
import { formatDuration } from '../../utils/formatTime';

/** Tapping cycles through these. Kept to three: a long press-and-hold menu
 *  for a control this small would cost more taps than it saves. */
const SPEEDS = [1, 1.5, 2] as const;

const BAR_COUNT = 22;
// A fixed, deterministic silhouette (no real waveform decoding — that needs
// native audio analysis beyond what this pass adds) that still reads as a
// genuine voice-memo shape rather than a plain progress bar. Same seed on
// every render so it doesn't reshuffle mid-playback.
const BAR_HEIGHTS = Array.from({ length: BAR_COUNT }, (_, i) => {
  const wave = Math.sin(i * 0.9) * 0.5 + Math.sin(i * 0.35) * 0.5;
  return 5 + Math.abs(wave) * 13;
});

/**
 * A real inline voice-message player: downloads the file once (through the
 * authenticated /api/media/:id proxy, same as MediaFileChip's share flow)
 * to local cache, then plays it in place with a tap-to-scrub-free progress
 * waveform driven by expo-audio's live playback status.
 */
export function AudioMessageBubble({
  mediaId,
  tint,
  onLongPress,
}: {
  mediaId: string;
  tint: string;
  /** Forwarded to the row's Pressable so long-press reaches the bubble's
   *  action sheet instead of being swallowed here. */
  onLongPress?: () => void;
}) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { spacing, typography } = useTheme();
  const { width } = useWindowDimensions();
  // The row's content column is flex:1, but a message bubble sizes itself to
  // its content — so with nothing to flex against it collapsed and the
  // waveform/duration were squashed. (A fixed minWidth used to hold this
  // open; it was dropped during the touch-target pass, which is what broke
  // the card.) Restored as a responsive floor instead of a hardcoded one:
  // wide enough for the 22 bars plus the play button, capped so it can't
  // overflow the bubble's own 80% ceiling on a small screen.
  const rowMinWidth = Math.min(Math.max(width * 0.5, 180), 240);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(0);
  const autoPlayRef = useRef(false);

  const player = useAudioPlayer(localUri ?? undefined);
  const status = useAudioPlayerStatus(player);
  const speed = SPEEDS[speedIndex]!;

  // Re-applied whenever the player is (re)loaded, not only when the user
  // taps: the rate lives on the native player, so a file that finishes
  // downloading after the choice was made would otherwise start at 1x.
  useEffect(() => {
    if (!status.isLoaded) return;
    // 'high' keeps the voice from turning chipmunky at 2x, which is the
    // whole point of a speed control on voice notes.
    player.setPlaybackRate(speed, 'high');
  }, [player, speed, status.isLoaded]);

  const cycleSpeed = useCallback(() => {
    setSpeedIndex((i) => (i + 1) % SPEEDS.length);
  }, []);

  useEffect(() => {
    if (autoPlayRef.current && status.isLoaded) {
      autoPlayRef.current = false;
      player.play();
    }
  }, [status.isLoaded, player]);

  const handlePress = async () => {
    // Guards its own re-entry now that the Pressable is no longer
    // `disabled` during the download (see the comment on onLongPress
    // below) — without this, a second tap would start a second download of
    // the same file.
    if (downloading) return;
    setError(false);
    if (!localUri) {
      setDownloading(true);
      try {
        const destination = new File(Paths.cache, `voxo-voice-${mediaId}.m4a`);
        const result = await File.downloadFileAsync(mediaUrl(mediaId), destination, {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
          idempotent: true,
        });
        autoPlayRef.current = true;
        setLocalUri(result.uri);
      } catch {
        setError(true);
      } finally {
        setDownloading(false);
      }
      return;
    }
    if (status.playing) {
      player.pause();
    } else {
      if (status.currentTime >= status.duration && status.duration > 0) {
        await player.seekTo(0);
      }
      player.play();
    }
  };

  const progress = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  const filledBars = Math.round(progress * BAR_COUNT);
  const remaining = status.isLoaded && status.duration > 0 ? status.duration - status.currentTime : status.duration;

  return (
    <Pressable
      onPress={handlePress}
      // Not `disabled` while downloading: a disabled Pressable stops
      // responding entirely, which would take the bubble's action sheet
      // away for as long as the file is being fetched. handlePress guards
      // its own re-entry instead.
      onLongPress={onLongPress}
      style={[styles.row, { minWidth: rowMinWidth }]}
    >
      <View style={[styles.playButton, { backgroundColor: `${tint}22` }]}>
        {downloading ? (
          <ActivityIndicator color={tint} size="small" />
        ) : (
          <Ionicons name={status.playing ? 'pause' : 'play'} size={16} color={tint} style={status.playing ? undefined : styles.playIconNudge} />
        )}
      </View>

      <View style={{ marginLeft: spacing.sm, flex: 1 }}>
        <View style={styles.waveform}>
          {BAR_HEIGHTS.map((height, i) => (
            <View
              key={i}
              style={[
                styles.bar,
                { height, backgroundColor: tint, opacity: i < filledBars ? 1 : 0.35 },
              ]}
            />
          ))}
        </View>
        <Text style={[typography.caption, { color: tint, opacity: 0.85, marginTop: 3 }]}>
          {error ? 'Failed to load — tap to retry' : formatDuration(remaining || 0)}
        </Text>
      </View>

      {/* Only once there is something to play — before that it would just
          be a dead control on a bubble that has not downloaded yet. */}
      {localUri ? (
        <Pressable
          onPress={cycleSpeed}
          hitSlop={8}
          style={[styles.speedButton, { borderColor: tint }]}
          accessibilityRole="button"
          accessibilityLabel={`Playback speed ${speed}x, tap to change`}
        >
          {({ pressed }) => (
            <Text style={[typography.caption, { color: tint, opacity: pressed ? 0.5 : 1, fontWeight: '600' }]}>
              {speed}x
            </Text>
          )}
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The whole row is the play/pause Pressable, so it carries the touch
  // target for this control rather than the 32dp circle drawn inside it.
  row: { flexDirection: 'row', alignItems: 'center', minHeight: touchTarget.compact },
  playButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  playIconNudge: { marginLeft: 2 },
  speedButton: {
    marginLeft: 8,
    minWidth: 34,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.8,
  },
  waveform: { flexDirection: 'row', alignItems: 'center', height: 20 },
  bar: { width: 2.5, borderRadius: 1.5, marginRight: 2.5 },
});
