import React, { useCallback, useMemo } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { EmptyState } from '../../components/EmptyState';
import {
  useNotifications,
  flattenNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '../../queries/useNotifications';
import { formatChatListTime } from '../../utils/formatTime';
import type { AppNotification } from '../../api/types';

const ICONS: Record<AppNotification['type'], keyof typeof Ionicons.glyphMap> = {
  MESSAGE_RECEIVED: 'chatbubble-ellipses-outline',
  MESSAGE_FAILED: 'alert-circle-outline',
  SUBSCRIPTION_EXPIRING: 'time-outline',
  SUBSCRIPTION_EXPIRED: 'close-circle-outline',
  ACCOUNT_DISABLED: 'lock-closed-outline',
  CALL_MISSED: 'call-outline',
  SYSTEM: 'information-circle-outline',
};

const NotificationRow = React.memo(function NotificationRow({
  item,
  onPress,
}: {
  item: AppNotification;
  onPress: (item: AppNotification) => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const unread = !item.readAt;

  return (
    <Pressable
      onPress={() => onPress(item)}
      style={[styles.row, { padding: spacing.md, backgroundColor: unread ? colors.primaryMuted : colors.background }]}
    >
      <Ionicons name={ICONS[item.type]} size={22} color={unread ? colors.primary : colors.textSecondary} />
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]} numberOfLines={2}>
          {item.body}
        </Text>
      </View>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>{formatChatListTime(item.createdAt)}</Text>
    </Pressable>
  );
});

export function NotificationsScreen() {
  const { colors, spacing, typography } = useTheme();
  const query = useNotifications();
  // Keyed off the query data (stable from react-query) rather than the fresh
  // array flatten allocates, so downstream memos actually hold.
  const notifications = useMemo(() => flattenNotifications(query.data), [query.data]);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const handleRowPress = useCallback(
    (item: AppNotification) => {
      if (!item.readAt) markRead.mutate(item.id);
    },
    [markRead],
  );

  const renderItem = useCallback(
    ({ item }: { item: AppNotification }) => <NotificationRow item={item} onPress={handleRowPress} />,
    [handleRowPress],
  );

  const hasUnread = notifications.some((n) => !n.readAt);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {hasUnread ? (
        <Pressable
          onPress={() => markAllRead.mutate()}
          style={[styles.markAllRow, { padding: spacing.md }]}
          disabled={markAllRead.isPending}
        >
          <Text style={[typography.label, { color: colors.primary }]}>Mark all as read</Text>
        </Pressable>
      ) : null}

      {query.isLoading ? null : notifications.length === 0 ? (
        <EmptyState icon="checkmark-circle-outline" title="You're all caught up" subtitle="No notifications right now." />
      ) : (
        <FlashList
          data={notifications}
          keyExtractor={(item: AppNotification) => item.id}
          renderItem={renderItem}
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
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  markAllRow: { alignItems: 'flex-end' },
});
