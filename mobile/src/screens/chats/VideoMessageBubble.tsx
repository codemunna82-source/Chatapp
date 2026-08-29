import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import { useVideoPlayer, VideoView } from 'expo-video';
import { mediaUrl } from '../../api/endpoints/media';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../theme/ThemeProvider';
import { impactLight } from '../../utils/haptics';

/**
 * A video that plays inside the bubble instead of being handed to another
 * app.
 *
 * The file is downloaded once through the authenticated media proxy
 * (backend GET /api/media/:id — the Meta access token never reaches the
 * client) and played from disk, exactly like MediaImage and
 * AudioMessageBubble. Playing straight from the proxy URL would work but
 * would re-stream the whole video every time the bubble scrolled back into
 * view, and would not play at all offline.
 *
 * Playback does not start until the user taps. Videos in a shared business
 * inbox arrive unannounced; auto-playing one out loud in a meeting is the
 * kind of thing that gets an app closed.
 */
export function VideoMessageBubble({
  mediaId,
  localUri: providedUri,
  onLongPress,
}: {
  mediaId?: string;
  /** A just-picked local file, still uploading. */
  localUri?: string;
  onLongPress?: () => void;
}) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { colors, radius, typography } = useTheme();
  const { width } = useWindowDimensions();
  const [downloadedUri, setDownloadedUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);

  // 16:9, sized off the live window for the same reason MediaImage is: the
  // bubble is maxWidth 80%, so a fixed width overflows a small phone.
  const boxWidth = Math.round(Math.min(Math.max(width * 0.58, 180), 280));
  const box = { width: boxWidth, height: Math.round((boxWidth * 9) / 16) };

  const displayUri = providedUri ?? downloadedUri;

  // A null source is valid for expo-video and simply leaves the player
  // empty, which is what should show while the download is still running.
  const player = useVideoPlayer(displayUri ?? null, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    if (providedUri || !mediaId) return;

    let cancelled = false;
    // The extension matters: ExoPlayer picks its extractor from it, and a
    // file with no suffix is guessed at.
    const target = new File(Paths.cache, `voxo-media-${mediaId}.mp4`);

    (async () => {
      try {
        if (target.exists) {
          if (!cancelled) setDownloadedUri(target.uri);
          return;
        }
        const result = await File.downloadFileAsync(mediaUrl(mediaId), target, {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
          idempotent: true,
        });
        if (!cancelled) setDownloadedUri(result.uri);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mediaId, providedUri, accessToken]);

  if (failed) {
    return (
      <Pressable
        onLongPress={onLongPress}
        style={[box, styles.center, { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm }]}
      >
        <Ionicons name="videocam-off-outline" size={26} color={colors.textSecondary} />
        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 4 }]}>Video unavailable</Text>
      </Pressable>
    );
  }

  const handlePlay = () => {
    if (!displayUri) return;
    impactLight();
    setStarted(true);
    player.play();
  };

  return (
    <View style={[box, { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: '#000000' }]}>
      <VideoView
        style={box}
        player={player}
        contentFit="contain"
        // Controls only appear once playback has been asked for, so the
        // resting state is a clean poster rather than a control bar.
        nativeControls={started}
      />

      {/* While it is not playing, a transparent layer on top owns the
          touches. This is what keeps long-press (react / reply / forward)
          working on a video at all: VideoView's own controls would
          otherwise consume every gesture the moment it mounted. */}
      {!started ? (
        <Pressable
          style={[StyleSheet.absoluteFill, styles.center]}
          onPress={handlePlay}
          onLongPress={onLongPress}
          accessibilityRole="button"
          accessibilityLabel="Play video"
        >
          {displayUri ? (
            <View style={styles.playBadge}>
              <Ionicons name="play" size={26} color="#FFFFFF" />
            </View>
          ) : (
            <ActivityIndicator color="#FFFFFF" />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  playBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    // Fixed translucent black rather than a theme token: it sits directly
    // on video frames, whose colours no palette can predict.
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingLeft: 4, // optical centering — a play triangle looks left-heavy when geometrically centred
  },
});
