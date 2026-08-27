import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface StatCardProps {
  label: string;
  value: string | number;
  tone?: 'default' | 'danger';
}

export function StatCard({ label, value, tone = 'default' }: StatCardProps) {
  const { colors, spacing, radius, typography } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderColor: colors.border },
      ]}
    >
      <Text style={[typography.title, { color: tone === 'danger' ? colors.danger : colors.textPrimary }]}>{value}</Text>
      <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 120, borderWidth: StyleSheet.hairlineWidth },
});
