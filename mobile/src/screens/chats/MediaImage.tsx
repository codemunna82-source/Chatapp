import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, PixelRatio, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { downloadMedia } from './mediaCache';
import { clampRatio, readMediaRatio, writeMediaRatio } from '../../storage/mediaShape';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../theme/ThemeProvider';
import { UploadProgress } from './UploadProgress';

/**
 * Inline authenticated image — the media proxy (backend GET /api/media/:id)
 * requires the same bearer token as every other request, since the bytes
 * come from Meta and the Meta access token itself never reaches the client
 * (architecture doc §4).
 *
 * The file is downloaded once into the cache directory and rendered from
 * disk afterwards. Previously this pointed RN's Image straight at the proxy
 * URL, so every mount — every time a bubble scrolled back into view —
 * re-fetched the full image over the network. Same approach
 * AudioMessageBubble already uses for voice notes.
 */
function MediaImageImpl({
  mediaId,
  localUri: providedUri,
  uploadProgress,
  size,
  onOpen,
  onLongPress,
}: {
  mediaId?: string;
  /** A local file to render directly — used for a just-picked, still-uploading photo. */
  localUri?: string;
  /** 0-1 while this photo's bytes are still going up; absent once sent. */
  uploadProgress?: number;
  /**
   * An exact square side, for a caller that has already decided the
   * layout — an album cell. Absent means the standalone bubble sizing
   * below, which is what a single photo wants.
   */
  size?: number;
  onOpen?: (localUri: string, mediaId?: string) => void;
  /** The bubble's action sheet. Handled here because this Pressable would
   *  otherwise swallow the long press before the bubble ever sees it. */
  onLongPress?: () => void;
}) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { colors, radius } = useTheme();
  const { width } = useWindowDimensions();
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /**
   * Which photo this component is currently showing.
   *
   * FlashList RECYCLES these rows, so the same component instance is
   * handed a different photo as the list scrolls. Everything about the
   * shape below is tagged with this, or a tall picture would keep its box
   * when the row was reused for a wide one.
   */
  const shapeKey = mediaId ?? providedUri;

  /**
   * width / height as remembered from the last time this photo was seen —
   * on this launch or any earlier one — so a photo already looked at is
   * the right shape on its first frame rather than snapping into place
   * once the file loads.
   */
  const remembered = useMemo(() => readMediaRatio(mediaId), [mediaId]);
  const [measured, setMeasured] = useState<{ key: string | undefined; ratio: number } | null>(null);
  const ratio = (measured && measured.key === shapeKey ? measured.ratio : null) ?? remembered;

  // Sized from the live window rather than a fixed square: the enclosing
  // bubble is maxWidth 80%, so a hardcoded size overflowed on a 320dp phone
  // and left dead space on a 430dp one.
  const side = size ?? Math.round(Math.min(Math.max(width * 0.58, 160), 280));
  /**
   * The box the photo is drawn in.
   *
   * An album cell is given an exact square by its caller and stays one —
   * a grid of differently-shaped tiles is not a grid. Everywhere else the
   * width is fixed and the HEIGHT follows the picture, which is the whole
   * point: every photo used to be forced into a square and cropped by
   * `cover`, so a portrait shot lost its top and bottom and a wide one
   * lost its sides. Until the shape is known it stays square, which is
   * the same neutral placeholder as before.
   */
  const box =
    size !== undefined || !ratio
      ? { width: side, height: side }
      : { width: side, height: Math.round(side / ratio) };

  /** Learns this photo's shape from the file itself, and remembers it. */
  const measure = useCallback(
    (uri: string) => {
      Image.getSize(
        uri,
        (w, h) => {
          const next = clampRatio(w, h);
          if (next === null) return;
          setMeasured({ key: shapeKey, ratio: next });
          // Only server-backed media is worth remembering: a local file
          // being sent is about to become a real message with a real id,
          // and its temporary path will never be asked about again.
          writeMediaRatio(mediaId, next);
        },
        () => {
          // A photo that cannot be measured is still a photo. It keeps the
          // square box, which is exactly what it had before this existed.
        },
      );
    },
    [mediaId, shapeKey],
  );

  /**
   * What this bubble actually needs, in physical pixels.
   *
   * `side` is layout units; the screen draws them at 2x or 3x, and asking
   * for the layout number would have handed a 3x phone a third of the
   * pixels it paints and made every photo in the app soft. The server
   * snaps this up to its own ladder, so the exact figure only has to be
   * honest, not round.
   */
  const requestWidth = PixelRatio.getPixelSizeForLayoutSize(side);

  useEffect(() => {
    // A locally-picked photo needs no fetch at all — providedUri is used
    // directly below, so there is nothing to synchronise here.
    if (providedUri || !mediaId) return;

    let cancelled = false;
    (async () => {
      try {
        const uri = await downloadMedia(mediaId, accessToken, requestWidth);
        if (cancelled) return;
        setLocalUri(uri);
        // The downloaded file is the only thing that knows this photo's
        // proportions, and it is already on disk — so measuring costs a
        // decode that was going to happen anyway.
        measure(uri);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      // The component can unmount mid-download while scrolling; don't set
      // state on it afterwards.
      cancelled = true;
    };
  }, [mediaId, providedUri, accessToken, requestWidth, measure]);

  // A photo being SENT is on disk already and has no download to hook
  // measuring onto, so it gets its own. Without this a just-picked
  // portrait sat in a square until the send resolved and then jumped.
  useEffect(() => {
    if (providedUri) measure(providedUri);
  }, [providedUri, measure]);

  // Derived, not stored: the local file wins when present, otherwise
  // whatever the download produced.
  const displayUri = providedUri ?? localUri;

  // A photo we are sending: it is rendered from a local file and has no
  // server id yet. Once the send resolves the row is replaced by the real
  // message, which has a mediaId and no progress.
  const uploading = Boolean(providedUri) && !mediaId;

  if (failed) {
    return (
      <View style={[box, styles.center, { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm }]}>
        <Ionicons name="image-outline" size={28} color={colors.textSecondary} />
      </View>
    );
  }

  return (
    <Pressable
      // Opening the viewer passes the already-cached file, so a full-screen
      // photo costs no extra request and works offline.
      onPress={displayUri && onOpen ? () => onOpen(displayUri, mediaId) : undefined}
      // Long-press has to reach the bubble's action sheet even while the
      // photo is still downloading, so this Pressable is never `disabled`:
      // a disabled Pressable stops responding entirely, which would take
      // React/Reply/Forward away for as long as the image is loading.
      onLongPress={onLongPress}
      accessibilityRole={onOpen ? 'imagebutton' : 'image'}
      accessibilityLabel="Photo"
      style={[box, { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surfaceAlt }]}
    >
      {displayUri ? (
        <Image source={{ uri: displayUri }} style={box} resizeMode="cover" onError={() => setFailed(true)} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}
      {/* Only while the bytes are going up. `uploading` is the local photo
          being sent, never the downloading of someone else's — those are
          two different waits and conflating them would put a percentage
          on an image that is merely loading. */}
      {uploading && <UploadProgress progress={uploadProgress} />}
    </Pressable>
  );
}

/** Memoized: keyed only on mediaId, so it survives unrelated bubble re-renders. */
export const MediaImage = React.memo(MediaImageImpl);

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
