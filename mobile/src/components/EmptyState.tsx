import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Distinguishes a genuine "nothing here yet" from a failed request — same layout, a different icon/tone reads as an error at a glance. */
  tone?: 'empty' | 'error';
}

/**
 * The one empty/error-state layout every list screen should reach for —
 * spec brief §19. Centered icon-in-a-soft-circle, title, optional
 * subtitle, optional retry/primary action. Deliberately screen-filling
 * (flex: 1) so it reads as the screen's actual content, not an
 * afterthought squeezed above a list.
 */
export function EmptyState({ icon, title, subtitle, actionLabel, onAction, tone = 'empty' }: EmptyStateProps) {
  const { colors, spacing, radius, typography } = useTheme();
  const iconColor = tone === 'error' ? colors.danger : colors.textTertiary;
  const iconBackground = tone === 'error' ? colors.dangerMuted : colors.surfaceAlt;

  return (
    <View style={styles.container}>
      {/* A small composed illustration rather than a bare glyph. Built from
          plain Views — soft overlapping blobs behind a raised disc, with a
          few floating specks — because the project has no SVG or
          illustration dependency, and adding one to draw four circles
          would cost more than it is worth. The result still reads as
          artwork rather than as a missing image. */}
      <View style={[styles.art, { marginBottom: spacing.md }]}>
        <View
          style={[
            styles.blob,
            styles.blobLeft,
            { backgroundColor: tone === 'error' ? colors.dangerMuted : colors.primaryMuted },
          ]}
        />
        <View style={[styles.blob, styles.blobRight, { backgroundColor: iconBackground }]} />

        <View style={[styles.speck, styles.speckTop, { backgroundColor: iconColor }]} />
        <View style={[styles.speck, styles.speckSide, { backgroundColor: iconColor }]} />
        <View style={[styles.speckSmall, styles.speckBottom, { backgroundColor: iconColor }]} />

        <View
          style={[
            styles.iconCircle,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.full,
            },
          ]}
        >
          <Ionicons name={icon} size={30} color={iconColor} />
        </View>
      </View>
      <Text style={[typography.bodyMedium, { color: colors.textPrimary, textAlign: 'center' }]}>{title}</Text>
      {subtitle ? (
        <Text
          style={[
            typography.caption,
            { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs, maxWidth: 280 },
          ]}
        >
          {subtitle}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: spacing.lg, minWidth: 160 }}>
          <Button label={actionLabel} variant="secondary" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

const ART_SIZE = 132;

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  art: { width: ART_SIZE, height: ART_SIZE, alignItems: 'center', justifyContent: 'center' },
  // Two overlapping soft shapes, each with one corner left square, so the
  // backdrop has a direction instead of being a plain circle.
  blob: { position: 'absolute', width: 96, height: 96, borderRadius: 48 },
  blobLeft: { left: 4, top: 10, borderBottomLeftRadius: 26, opacity: 0.9 },
  blobRight: { right: 2, bottom: 6, borderTopRightRadius: 26, opacity: 0.75 },
  speck: { position: 'absolute', width: 8, height: 8, borderRadius: 4, opacity: 0.45 },
  speckSmall: { position: 'absolute', width: 5, height: 5, borderRadius: 2.5, opacity: 0.35 },
  speckTop: { top: 2, right: 30 },
  speckSide: { left: 0, bottom: 34 },
  speckBottom: { bottom: 6, right: 22 },
  iconCircle: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    // Lifted off the blobs so the glyph stays legible whatever is behind it.
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
});
