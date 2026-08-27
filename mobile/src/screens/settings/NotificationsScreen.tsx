import React from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
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

function NotificationRow({ item, onPress }: { item: AppNotification; onPress: () => void }) {
  const { colors, spacing, typography } = useTheme();
  const unread = !item.readAt;

  return (
    <Pressable
      onPress={onPress}
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
}

export function NotificationsScreen() {
  const { colors, spacing, typography } = useTheme();
  const query = useNotifications();
  const notifications = flattenNotifications(query.data);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

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
        <View style={styles.empty}>
          <Text style={[typography.body, { color: colors.textSecondary }]}>You&apos;re all caught up.</Text>
        </View>
      ) : (
        <FlashList
          data={notifications}
          keyExtractor={(item: AppNotification) => item.id}
          renderItem={({ item }: { item: AppNotification }) => (
            <NotificationRow item={item} onPress={() => (!item.readAt ? markRead.mutate(item.id) : undefined)} />
          )}
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
});
