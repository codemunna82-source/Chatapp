import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import { DashboardSkeleton } from '../../components/Skeleton';
import { InlineBanner } from '../../components/InlineBanner';
import { StatCard } from '../../components/StatCard';
import { MessagesBarChart } from './MessagesBarChart';
import { useDashboard } from '../../queries/useDashboard';
import { useTheme } from '../../theme/ThemeProvider';
import { getApiErrorMessage } from '../../api/client';

export function DashboardScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const dashboard = useDashboard();

  if (dashboard.isLoading) {
    // A skeleton in the real layout rather than a centred spinner: the
    // dashboard's shape is what the user is waiting to read, and matching
    // it means nothing jumps when the numbers land.
    return (
      <Screen>
        <DashboardSkeleton />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={dashboard.isRefetching} onRefresh={() => dashboard.refetch()} />}
      >
        <Text style={[typography.heading, { color: colors.textPrimary, marginBottom: spacing.md }]}>Dashboard</Text>

        {dashboard.isError ? (
          <InlineBanner message={getApiErrorMessage(dashboard.error, 'Could not load dashboard data.')} />
        ) : null}

        {dashboard.data ? (
          <>
            <View style={[styles.grid, { marginBottom: spacing.md, gap: spacing.sm }]}>
              <StatCard label="Contacts" value={dashboard.data.contactsTotal} />
              <StatCard label="Open chats" value={dashboard.data.conversations.open} />
              <StatCard label="Unread" value={dashboard.data.conversations.unreadTotal} />
            </View>
            <View style={[styles.grid, { marginBottom: spacing.lg, gap: spacing.sm }]}>
              <StatCard label="Messages sent" value={dashboard.data.messages.sentTotal} />
              <StatCard label="Messages received" value={dashboard.data.messages.receivedTotal} />
              <StatCard label="Failed sends" value={dashboard.data.messages.failedTotal} tone="danger" />
            </View>

            <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
              Messages — last 14 days
            </Text>
            <View
              style={[
                styles.chartCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  padding: spacing.md,
                  marginBottom: spacing.lg,
                },
              ]}
            >
              <MessagesBarChart data={dashboard.data.messagesByDay} />
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  chartCard: { borderWidth: StyleSheet.hairlineWidth },
});
