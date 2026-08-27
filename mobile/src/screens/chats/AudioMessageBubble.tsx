import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { mediaUrl } from '../../api/endpoints/media';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../theme/ThemeProvider';
import { formatDuration } from '../../utils/formatTime';

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
export function AudioMessageBubble({ mediaId, tint }: { mediaId: string; tint: string }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { spacing, typography } = useTheme();
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(false);
  const autoPlayRef = useRef(false);

  const player = useAudioPlayer(localUri ?? undefined);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    if (autoPlayRef.current && status.isLoaded) {
      autoPlayRef.current = false;
      player.play();
    }
  }, [status.isLoaded, player]);

  const handlePress = async () => {
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
    <Pressable onPress={handlePress} disabled={downloading} style={styles.row}>
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
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minWidth: 200 },
  playButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  playIconNudge: { marginLeft: 2 },
  waveform: { flexDirection: 'row', alignItems: 'center', height: 20 },
  bar: { width: 2.5, borderRadius: 1.5, marginRight: 2.5 },
});
