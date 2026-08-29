import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import type { DashboardSummary } from '../../api/types';

/**
 * Describes today against yesterday.
 *
 * Percentages are deliberately not shown when yesterday was zero: "+100%"
 * off a base of nothing is a number that looks like information and isn't.
 * In that case the card says "new today" instead, which is the honest
 * reading.
 */
function describeDelta(today: number, yesterday: number): { label: string; direction: 'up' | 'down' | 'flat' } {
  if (today === yesterday) return { label: 'same as yesterday', direction: 'flat' };
  if (yesterday === 0) return { label: 'new today', direction: 'up' };
  const change = Math.round(((today - yesterday) / yesterday) * 100);
  return {
    label: `${change > 0 ? '+' : ''}${change}% vs yesterday`,
    direction: change > 0 ? 'up' : 'down',
  };
}

function TodayMetric({
  label,
  value,
  yesterday,
  /** Received traffic going down is not a failure the way sent going down is, so the arrow is coloured neutrally for it. */
  neutral,
}: {
  label: string;
  value: number;
  yesterday: number;
  neutral?: boolean;
}) {
  const { colors, typography, spacing } = useTheme();
  const delta = describeDelta(value, yesterday);
  const tint =
    neutral || delta.direction === 'flat'
      ? colors.textSecondary
      : delta.direction === 'up'
        ? colors.success
        : colors.danger;

  return (
    <View style={{ flex: 1 }}>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[typography.display, { color: colors.textPrimary, marginTop: 2 }]}>{value}</Text>
      <View style={[styles.deltaRow, { marginTop: spacing.xs }]}>
        <Ionicons
          name={delta.direction === 'up' ? 'trending-up' : delta.direction === 'down' ? 'trending-down' : 'remove'}
          size={14}
          color={tint}
        />
        <Text style={[typography.caption, { color: tint, marginLeft: 4 }]} numberOfLines={1}>
          {delta.label}
        </Text>
      </View>
    </View>
  );
}

export function TodayCard({ today }: { today: DashboardSummary['today'] }) {
  const { colors, spacing, radius, typography } = useTheme();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.lg,
          padding: spacing.md,
          marginBottom: spacing.md,
        },
      ]}
    >
      <View style={[styles.header, { marginBottom: spacing.sm }]}>
        <View style={[styles.dot, { backgroundColor: colors.success }]} />
        <Text style={[typography.label, { color: colors.textSecondary, marginLeft: spacing.xs }]}>Today</Text>
      </View>
      <View style={styles.row}>
        <TodayMetric label="Sent" value={today.sent} yesterday={today.sentYesterday} />
        <View style={[styles.divider, { backgroundColor: colors.border, marginHorizontal: spacing.md }]} />
        <TodayMetric label="Received" value={today.received} yesterday={today.receivedYesterday} neutral />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth },
  header: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  deltaRow: { flexDirection: 'row', alignItems: 'center' },
});
