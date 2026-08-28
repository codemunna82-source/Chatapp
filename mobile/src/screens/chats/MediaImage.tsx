import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { mediaUrl } from '../../api/endpoints/media';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Inline authenticated image — the media proxy (backend GET /api/media/:id)
 * requires the same bearer token as every other request, since the bytes
 * come from Meta and the Meta access token itself never reaches the client
 * (architecture doc §4). React Native's Image supports per-request headers
 * for network sources, including on Android.
 */
function MediaImageImpl({ mediaId }: { mediaId: string }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { colors, radius } = useTheme();
  const { width } = useWindowDimensions();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Sized from the live window rather than a fixed 220dp: the enclosing
  // bubble is maxWidth 80%, so a hardcoded square overflowed the bubble on
  // a 320dp-wide phone and left dead space on a 430dp one. Recomputed on
  // window/orientation change because useWindowDimensions subscribes.
  const side = Math.round(Math.min(Math.max(width * 0.58, 160), 280));
  // Memoized so the style object and the image source keep a stable identity
  // between renders — a new source object makes RN re-request the image
  // through the authenticated media proxy, which on a chat full of photos
  // means repeated network work and visible reload flicker while scrolling.
  const box = useMemo(() => ({ width: side, height: side }), [side]);
  const source = useMemo(
    () => ({ uri: mediaUrl(mediaId), headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined }),
    [mediaId, accessToken],
  );

  if (failed) {
    return (
      <View style={[box, styles.center, { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm }]}>
        <Ionicons name="image-outline" size={28} color={colors.textSecondary} />
      </View>
    );
  }

  return (
    <View style={[box, { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surfaceAlt }]}>
      <Image
        source={source}
        style={box}
        resizeMode="cover"
        onError={() => setFailed(true)}
        onLoadEnd={() => setLoaded(true)}
      />
      {!loaded ? (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}
    </View>
  );
}

/** Memoized: keyed only on mediaId, so it survives unrelated bubble re-renders. */
export const MediaImage = React.memo(MediaImageImpl);

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
