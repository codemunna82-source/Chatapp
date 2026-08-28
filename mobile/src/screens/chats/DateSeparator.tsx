import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { formatDateSeparator } from '../../utils/formatTime';

function DateSeparatorImpl({ iso }: { iso: string }) {
  const { colors, spacing, radius, typography } = useTheme();
  return (
    <View style={[styles.container, { marginVertical: spacing.sm }]}>
      <View style={[styles.pill, { backgroundColor: colors.surfaceAlt, borderRadius: radius.full, paddingHorizontal: spacing.sm }]}>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{formatDateSeparator(iso)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  pill: { paddingVertical: 4 },
});

/** Memoized: one per day in the list, and its only prop is a fixed ISO string. */
export const DateSeparator = React.memo(DateSeparatorImpl);
