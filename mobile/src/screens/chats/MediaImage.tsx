import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import { mediaUrl } from '../../api/endpoints/media';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../theme/ThemeProvider';

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
function MediaImageImpl({ mediaId }: { mediaId: string }) {
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
  }, [mediaId, accessToken]);

  if (failed) {
    return (
      <View style={[box, styles.center, { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm }]}>
        <Ionicons name="image-outline" size={28} color={colors.textSecondary} />
      </View>
    );
  }

  return (
    <View style={[box, { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surfaceAlt }]}>
      {localUri ? (
        <Image source={{ uri: localUri }} style={box} resizeMode="cover" onError={() => setFailed(true)} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}
    </View>
  );
}

/** Memoized: keyed only on mediaId, so it survives unrelated bubble re-renders. */
export const MediaImage = React.memo(MediaImageImpl);

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
