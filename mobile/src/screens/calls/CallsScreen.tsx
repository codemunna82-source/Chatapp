import React, { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { CallLogItem } from './CallLogItem';
import { NewCallSheet } from './NewCallSheet';
import { useCallHistory, flattenCalls } from '../../queries/useCalls';
import { useTheme } from '../../theme/ThemeProvider';
import type { CallLog } from '../../api/types';

export function CallsScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const [sheetOpen, setSheetOpen] = useState(false);
  const query = useCallHistory();
  const calls = flattenCalls(query.data);

  const showEmpty = !query.isLoading && calls.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.headerRow, { padding: spacing.md }]}>
        <Text style={[typography.heading, { color: colors.textPrimary, flex: 1 }]}>Calls</Text>
        <Pressable
          onPress={() => setSheetOpen(true)}
          style={[styles.newCallButton, { backgroundColor: colors.primary, borderRadius: radius.full }]}
        >
          <Ionicons name="call" size={18} color={colors.textOnPrimary} />
        </Pressable>
      </View>

      {showEmpty ? (
        <View style={styles.empty}>
          <Ionicons name="call-outline" size={32} color={colors.textSecondary} style={{ marginBottom: spacing.sm }} />
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
            No calls yet. Tap the call button to start one — it opens the real WhatsApp app on this device.
          </Text>
        </View>
      ) : (
        <FlashList
          data={calls}
          keyExtractor={(item: CallLog) => item.id}
          renderItem={({ item }: { item: CallLog }) => <CallLogItem call={item} />}
          refreshControl={
            <RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={colors.primary} />
          }
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) {
              query.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ paddingBottom: spacing.lg }}
        />
      )}

      <NewCallSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  newCallButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
});
