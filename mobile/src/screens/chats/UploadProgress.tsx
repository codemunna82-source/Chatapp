import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * What an attachment looks like while its bytes are still going up.
 *
 * Sending a photo or a video used to show an indeterminate spinner — or,
 * from the attachment sheet, nothing but a covered screen. On a big video
 * over a weak connection that is indistinguishable from a stall, which is
 * exactly the moment people force-quit and send the thing twice.
 *
 * Drawn as a dimmed cover with a percentage and a determinate bar rather
 * than the ring WhatsApp uses: a ring needs an SVG renderer this app does
 * not ship, and a real number beating a fake ring is not a close call.
 * The spinner is kept only for the case the platform reports no total, so
 * an honest "working" replaces a progress bar that would be invented.
 */
export function UploadProgress({ progress }: { progress?: number }) {
  const { colors, radius, typography } = useTheme();
  const known = typeof progress === 'number' && progress > 0;
  const pct = Math.round(Math.min(1, Math.max(0, progress ?? 0)) * 100);

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.cover, { borderRadius: radius.sm }]}
      accessibilityRole="progressbar"
      accessibilityLabel={known ? `Uploading, ${pct} percent` : 'Uploading'}
    >
      {known ? (
        <Text style={[typography.bodyMedium, styles.pct]}>{pct}%</Text>
      ) : (
        <ActivityIndicator color="#fff" />
      )}

      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              backgroundColor: colors.success,
              // An unknown total leaves the track empty rather than
              // pretending to a position it does not have.
              width: known ? `${pct}%` : '0%',
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  pct: { color: '#fff', fontVariant: ['tabular-nums'] },
  track: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  fill: { height: '100%', borderRadius: 2 },
});
