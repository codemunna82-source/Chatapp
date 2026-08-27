import React, { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { EmptyState } from '../../components/EmptyState';
import { CallLogItem } from './CallLogItem';
import { NewCallSheet } from './NewCallSheet';
import { useCallHistory, flattenCalls } from '../../queries/useCalls';
import { useTheme } from '../../theme/ThemeProvider';
import type { CallLog } from '../../api/types';

export function CallsScreen() {
  const { colors, spacing, radius, shadow, typography } = useTheme();
  const [sheetOpen, setSheetOpen] = useState(false);
  const query = useCallHistory();
  const calls = flattenCalls(query.data);

  const showEmpty = !query.isLoading && calls.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.headerRow, { padding: spacing.md }]}>
        <Text style={[typography.heading, { color: colors.textPrimary }]}>Calls</Text>
      </View>

      {showEmpty ? (
        <EmptyState
          icon="call-outline"
          title="No calls yet"
          subtitle="Tap the call button below to start one — it opens the real WhatsApp app on this device."
          actionLabel="Start a call"
          onAction={() => setSheetOpen(true)}
        />
      ) : (
        <FlashList
          data={calls}
          keyExtractor={(item: CallLog) => item.id}
          renderItem={({ item }: { item: CallLog }) => <CallLogItem call={item} />}
          ListHeaderComponent={
            <Text style={[typography.label, { color: colors.textSecondary, paddingHorizontal: spacing.md, paddingBottom: spacing.xs }]}>
              Recent
            </Text>
          }
          refreshControl={
            <RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={colors.primary} />
          }
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) {
              query.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ paddingBottom: 88 }}
        />
      )}

      <Pressable
        onPress={() => setSheetOpen(true)}
        style={[styles.fab, shadow.lg, { backgroundColor: colors.primary, borderRadius: radius.full, bottom: spacing.lg }]}
        accessibilityLabel="Start a call"
      >
        <Ionicons name="call" size={22} color={colors.textOnPrimary} />
      </Pressable>

      <NewCallSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  fab: { position: 'absolute', right: 20, width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
});
