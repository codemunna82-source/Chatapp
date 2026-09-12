import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import { mediaUrl } from '../../api/endpoints/media';
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
  onOpen,
  onLongPress,
}: {
  mediaId?: string;
  /** A local file to render directly — used for a just-picked, still-uploading photo. */
  localUri?: string;
  /** 0-1 while this photo's bytes are still going up; absent once sent. */
  uploadProgress?: number;
  onOpen?: (localUri: string) => void;
  /** The bubble's action sheet. Handled here because this Pressable would
   *  otherwise swallow the long press before the bubble ever sees it. */
  onLongPress?: () => void;
}) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { colors, radius } = useTheme();
  const { width } = useWindowDimensions();
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Sized from the live window rather than a fixed square: the enclosing
  // bubble is maxWidth 80%, so a hardcoded size overflowed on a 320dp phone
  // and left dead space on a 430dp one.
  const side = Math.round(Math.min(Math.max(width * 0.58, 160), 280));
  const box = { width: side, height: side };

  useEffect(() => {
    // A locally-picked photo needs no fetch at all — providedUri is used
    // directly below, so there is nothing to synchronise here.
    if (providedUri || !mediaId) return;

    let cancelled = false;
    const target = new File(Paths.cache, `voxo-media-${mediaId}.img`);

    (async () => {
      try {
        // Already cached from a previous mount (or an earlier session) —
        // skip the network entirely.
        if (target.exists) {
          if (!cancelled) setLocalUri(target.uri);
          return;
        }
        const result = await File.downloadFileAsync(mediaUrl(mediaId), target, {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
          idempotent: true,
        });
        if (!cancelled) setLocalUri(result.uri);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      // The component can unmount mid-download while scrolling; don't set
      // state on it afterwards.
      cancelled = true;
    };
  }, [mediaId, providedUri, accessToken]);

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
      onPress={displayUri && onOpen ? () => onOpen(displayUri) : undefined}
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
