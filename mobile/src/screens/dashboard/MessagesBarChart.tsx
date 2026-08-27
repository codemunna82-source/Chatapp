import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import type { DashboardSummary } from '../../api/types';

const CHART_HEIGHT = 100;

/**
 * A plain-View bar strip — real per-day sent/received counts from the API,
 * not a placeholder. No charting library is pulled in for one component.
 */
export function MessagesBarChart({ data }: { data: DashboardSummary['messagesByDay'] }) {
  const { colors, spacing, radius, typography } = useTheme();
  const max = Math.max(1, ...data.map((d) => d.sent + d.received));

  return (
    <View>
      <View style={[styles.row, { height: CHART_HEIGHT }]}>
        {data.map((day) => {
          const sentHeight = (day.sent / max) * CHART_HEIGHT;
          const receivedHeight = (day.received / max) * CHART_HEIGHT;
          return (
            <View key={day.date} style={styles.barGroup}>
              <View style={styles.barPair}>
                <View style={[styles.bar, { height: sentHeight, backgroundColor: colors.primary, borderRadius: radius.sm }]} />
                <View style={[styles.bar, { height: receivedHeight, backgroundColor: colors.success, borderRadius: radius.sm }]} />
              </View>
            </View>
          );
        })}
      </View>
      <View style={[styles.legend, { marginTop: spacing.sm }]}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
          <Text style={[typography.caption, { color: colors.textSecondary }]}>Sent</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
          <Text style={[typography.caption, { color: colors.textSecondary, marginLeft: spacing.xs }]}>Received</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  barGroup: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  barPair: { flexDirection: 'row', alignItems: 'flex-end' },
  bar: { width: 3, marginHorizontal: 1, minHeight: 2 },
  legend: { flexDirection: 'row' },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 16 },
  legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 4 },
});
