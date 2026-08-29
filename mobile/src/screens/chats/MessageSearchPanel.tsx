import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { SearchBar } from '../../components/SearchBar';
import { EmptyState } from '../../components/EmptyState';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';
import { formatChatListTime } from '../../utils/formatTime';
import type { Message } from '../../api/types';

interface MessageSearchPanelProps {
  search: string;
  onChangeSearch: (value: string) => void;
  starredOnly: boolean;
  onToggleStarredOnly: () => void;
  results: Message[];
  loading: boolean;
  /** Whether the query has actually run — a debounce means "typed" and
   *  "searched" are not the same moment, and showing "no results" in the gap
   *  reads as a wrong answer. */
  searched: boolean;
  onSelect: (message: Message) => void;
  onEndReached: () => void;
}

/**
 * In-chat search and the starred list, as one panel over the thread.
 *
 * They share a surface because they are the same question — "find that one
 * message" — and because a starred list that lives somewhere else is a
 * second place to look. Toggling Starred keeps whatever is typed, so
 * "starred messages mentioning invoice" works without a separate filter UI.
 */
export function MessageSearchPanel({
  search,
  onChangeSearch,
  starredOnly,
  onToggleStarredOnly,
  results,
  loading,
  searched,
  onSelect,
  onEndReached,
}: MessageSearchPanelProps) {
  const { colors, spacing, radius, typography } = useTheme();

  const renderItem = ({ item }: { item: Message }) => (
    <Pressable
      onPress={() => onSelect(item)}
      style={[styles.row, { paddingHorizontal: spacing.md, paddingVertical: spacing.sm }]}
      accessibilityRole="button"
      accessibilityLabel={item.text ?? 'Message'}
    >
      {({ pressed }) => (
        <View style={{ opacity: pressed ? 0.6 : 1 }}>
          <View style={styles.rowHeader}>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {item.direction === 'OUT' ? 'You' : 'Customer'}
            </Text>
            <View style={styles.rowHeaderRight}>
              {item.starredAt ? <Ionicons name="star" size={12} color={colors.warning} /> : null}
              <Text style={[typography.caption, { color: colors.textTertiary, marginLeft: 6 }]}>
                {formatChatListTime(item.createdAt)}
              </Text>
            </View>
          </View>
          <Text style={[typography.body, { color: colors.textPrimary, marginTop: 2 }]} numberOfLines={3}>
            {/* A media message has no text to match on, so it needs a label
                rather than an empty row. */}
            {item.text || `[${item.type}]`}
          </Text>
        </View>
      )}
    </Pressable>
  );

  const showEmpty = searched && !loading && results.length === 0;

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}>
      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>
        <SearchBar value={search} onChangeText={onChangeSearch} placeholder="Search in this chat" autoFocus />
        <Pressable
          onPress={onToggleStarredOnly}
          style={[
            styles.starredToggle,
            {
              backgroundColor: starredOnly ? colors.primaryMuted : 'transparent',
              borderRadius: radius.md,
              paddingHorizontal: spacing.sm,
              marginTop: spacing.xs,
            },
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected: starredOnly }}
          accessibilityLabel="Show starred messages only"
        >
          <Ionicons
            name={starredOnly ? 'star' : 'star-outline'}
            size={16}
            color={starredOnly ? colors.primary : colors.textSecondary}
          />
          <Text
            style={[
              typography.label,
              { color: starredOnly ? colors.primary : colors.textSecondary, marginLeft: spacing.xs },
            ]}
          >
            Starred only
          </Text>
        </Pressable>
      </View>

      {loading && results.length === 0 ? (
        <ActivityIndicator style={{ marginTop: spacing.lg }} color={colors.primary} />
      ) : showEmpty ? (
        <EmptyState
          icon={starredOnly ? 'star-outline' : 'search-outline'}
          title={starredOnly ? 'No starred messages' : 'No matches'}
          subtitle={
            starredOnly
              ? 'Long-press a message and choose Star to keep it here.'
              : 'Try a shorter word, or part of a number.'
          }
        />
      ) : (
        <FlashList
          data={results}
          keyExtractor={(m: Message) => m.id}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          ItemSeparatorComponent={() => (
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.divider }} />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: touchTarget.min, justifyContent: 'center' },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowHeaderRight: { flexDirection: 'row', alignItems: 'center' },
  starredToggle: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', minHeight: touchTarget.compact },
});
