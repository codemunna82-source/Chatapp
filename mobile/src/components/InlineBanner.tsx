import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface InlineBannerProps {
  message: string;
  tone?: 'danger' | 'warning' | 'success';
}

/** Inline error/warning/success banner — form-level API errors, expiry warnings, etc. */
export function InlineBanner({ message, tone = 'danger' }: InlineBannerProps) {
  const { colors, spacing, radius, typography } = useTheme();
  const foreground = tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : colors.success;
  const background = tone === 'danger' ? colors.dangerMuted : tone === 'warning' ? colors.warningMuted : colors.successMuted;

  return (
    <View style={[styles.base, { backgroundColor: background, borderRadius: radius.md, padding: spacing.sm + 4, marginBottom: spacing.md }]}>
      <Text style={[typography.caption, { color: foreground }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { borderWidth: 0 },
});
