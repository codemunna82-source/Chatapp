import React from 'react';
import { Text } from 'react-native';
import { Screen } from './Screen';
import { useTheme } from '../theme/ThemeProvider';

/** Used by screens whose real implementation lands in a later phase — keeps the nav shell fully wired now. */
export function PlaceholderScreen({ title, note }: { title: string; note?: string }) {
  const { colors, spacing, typography } = useTheme();
  return (
    <Screen>
      <Text style={[typography.heading, { color: colors.textPrimary, marginBottom: spacing.xs }]}>{title}</Text>
      <Text style={[typography.body, { color: colors.textSecondary }]}>{note ?? 'Coming soon.'}</Text>
    </Screen>
  );
}
