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
      <View
        style={[
          styles.iconCircle,
          { backgroundColor: iconBackground, borderRadius: radius.full, marginBottom: spacing.md },
        ]}
      >
        <Ionicons name={icon} size={30} color={iconColor} />
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

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  iconCircle: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
});
