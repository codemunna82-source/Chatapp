import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { downloadPoster, downloadVideo } from './mediaCache';
import { clampRatio, readMediaRatio, writeMediaRatio } from '../../storage/mediaShape';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../theme/ThemeProvider';
import { UploadProgress } from './UploadProgress';
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
  uploadProgress,
  onLongPress,
}: {
  mediaId?: string;
  /** 0-1 while this video's bytes are still going up; absent once sent. */
  uploadProgress?: number;
  /** A just-picked local file, still uploading. */
  localUri?: string;
  onLongPress?: () => void;
}) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { colors, radius, typography } = useTheme();
  const { width } = useWindowDimensions();
  const [downloadedUri, setDownloadedUri] = useState<string | null>(null);
  const [posterUri, setPosterUri] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);
  /**
   * The file a tap asked to play, waiting for the player to be pointed at
   * it.
   *
   * A ref and not state: it is consumed exactly once. Playing on any
   * render where `started && displayUri` would resume the video every
   * time the row re-rendered, so pausing it with the native controls
   * would not stick.
   */
  const pendingPlay = useRef<string | null>(null);

  // FlashList recycles these rows, so everything below is tagged with
  // which video the component currently holds.
  const shapeKey = mediaId ?? providedUri;
  const remembered = useMemo(() => readMediaRatio(mediaId), [mediaId]);
  const [measured, setMeasured] = useState<{ key: string | undefined; ratio: number } | null>(null);
  const ratio = (measured && measured.key === shapeKey ? measured.ratio : null) ?? remembered;

  // Sized off the live window for the same reason MediaImage is: the
  // bubble is maxWidth 80%, so a fixed width overflows a small phone.
  // 16:9 only until the real shape is known — a portrait video in a
  // landscape box is two thick black bars and a stamp-sized picture.
  const boxWidth = Math.round(Math.min(Math.max(width * 0.58, 180), 280));
  const box = {
    width: boxWidth,
    height: Math.round(ratio ? boxWidth / ratio : (boxWidth * 9) / 16),
  };
  const posterWidth = PixelRatio.getPixelSizeForLayoutSize(boxWidth);

  const displayUri = providedUri ?? downloadedUri;
  // Being sent: rendered from a local file, with no server id yet.
  const uploading = Boolean(providedUri) && !mediaId;

  // A null source is valid for expo-video and simply leaves the player
  // empty, which is what should show while the download is still running.
  const player = useVideoPlayer(displayUri ?? null, (p) => {
    p.loop = false;
  });

  /**
   * The poster — and, from it, the video's shape.
   *
   * This replaces downloading the whole video on mount. Scrolling past
   * five videos used to fetch five whole files, up to sixteen megabytes
   * each, so that a still frame could be drawn: the exact thing §16 is
   * about. A poster is tens of kilobytes, and because it is an image the
   * app can measure it — which is how a video ends up in the right shape
   * without anything having stored its dimensions.
   */
  useEffect(() => {
    if (providedUri || !mediaId) return;

    let cancelled = false;
    (async () => {
      try {
        const uri = await downloadPoster(mediaId, accessToken, posterWidth);
        if (cancelled || !uri) return;
        setPosterUri(uri);
        Image.getSize(
          uri,
          (w, h) => {
            const next = clampRatio(w, h);
            if (next === null || cancelled) return;
            setMeasured({ key: mediaId, ratio: next });
            writeMediaRatio(mediaId, next);
          },
          () => {
            // Keeps 16:9. A poster that will not measure is still a poster.
          },
        );
      } catch {
        // No poster is not a broken video — the play badge below still
        // works, and tapping it fetches the file. Deliberately not
        // setFailed: that is for a video that cannot be played at all.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mediaId, providedUri, accessToken, posterWidth]);

  /**
   * Tap to play, fetching the video first if this is the first tap.
   *
   * The wait moved here from mount on purpose: it is paid once, by
   * someone who has asked for this specific video, instead of by everyone
   * who scrolls past it.
   */
  const handlePlay = useCallback(async () => {
    if (fetching) return;
    impactLight();

    if (displayUri) {
      setStarted(true);
      player.play();
      return;
    }
    if (!mediaId) return;

    setFetching(true);
    try {
      const uri = await downloadVideo(mediaId, accessToken);
      pendingPlay.current = uri;
      setDownloadedUri(uri);
      setStarted(true);
      // The player is pointed at the new source by the re-render this
      // causes; play() is called from the effect below once it has one.
    } catch {
      setFailed(true);
    } finally {
      setFetching(false);
    }
  }, [fetching, displayUri, mediaId, accessToken, player]);

  // Starts playback once a just-downloaded file has actually reached the
  // player. Calling play() straight after setDownloadedUri would run
  // against the previous, empty source.
  useEffect(() => {
    if (!displayUri || pendingPlay.current !== displayUri) return;
    pendingPlay.current = null;
    player.play();
  }, [displayUri, player]);

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

  return (
    <View style={[box, { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: '#000000' }]}>
      {/* The poster, until there is a video to show instead. VideoView
          draws its own first frame once it has a file — but it only has
          one after the whole thing is downloaded, which is precisely what
          this avoids. `cover` rather than `contain` because the box is
          already the poster's own shape, so there is nothing to letterbox. */}
      {posterUri && !displayUri ? (
        <Image source={{ uri: posterUri }} style={box} resizeMode="cover" />
      ) : (
        <VideoView
          style={box}
          player={player}
          contentFit="contain"
          // Controls only appear once playback has been asked for, so the
          // resting state is a clean poster rather than a control bar.
          nativeControls={started}
        />
      )}

      {/* While it is not playing, a transparent layer on top owns the
          touches. This is what keeps long-press (react / reply / forward)
          working on a video at all: VideoView's own controls would
          otherwise consume every gesture the moment it mounted. */}
      {!started ? (
        <Pressable
          style={[StyleSheet.absoluteFill, styles.center]}
          onPress={() => void handlePlay()}
          onLongPress={onLongPress}
          accessibilityRole="button"
          accessibilityLabel="Play video"
        >
          {/* A video still uploading is not playable yet, so the play
              badge would be a lie. The progress cover takes its place
              until the bytes are up.

              The badge now shows before the file has been fetched, which
              is the point of the change: tapping it is what fetches. The
              spinner is only for the fetch that tap starts. */}
          {uploading ? null : fetching ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <View style={styles.playBadge}>
              <Ionicons name="play" size={26} color="#FFFFFF" />
            </View>
          )}
        </Pressable>
      ) : null}
      {uploading && <UploadProgress progress={uploadProgress} />}
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
