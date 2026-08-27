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
  const background = tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : colors.success;

  return (
    <View style={[styles.base, { backgroundColor: `${background}22`, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.md }]}>
      <Text style={[typography.caption, { color: background }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { borderWidth: 0 },
});
