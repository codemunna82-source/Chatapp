import React, { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
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
export function MediaImage({ mediaId }: { mediaId: string }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { colors, radius } = useTheme();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (failed) {
    return (
      <View style={[styles.box, styles.center, { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm }]}>
        <Ionicons name="image-outline" size={28} color={colors.textSecondary} />
      </View>
    );
  }

  return (
    <View style={[styles.box, { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surfaceAlt }]}>
      <Image
        source={{ uri: mediaUrl(mediaId), headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined }}
        style={styles.box}
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

const styles = StyleSheet.create({
  box: { width: 220, height: 220 },
  center: { alignItems: 'center', justifyContent: 'center' },
});
