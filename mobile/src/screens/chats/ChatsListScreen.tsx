import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SearchBar } from '../../components/SearchBar';
import { ChatListSkeleton } from '../../components/Skeleton';
import { EmptyState } from '../../components/EmptyState';
import { ChatListItem } from './ChatListItem';
import { useConversations, flattenConversations, usePinConversation, useArchiveConversation } from '../../queries/useConversations';
import { useDebouncedValue } from '../../utils/useDebouncedValue';
import { useTheme } from '../../theme/ThemeProvider';
import type { ChatsStackParamList } from '../../navigation/types';
import type { Conversation } from '../../api/types';

type Props = NativeStackScreenProps<ChatsStackParamList, 'ChatsList'>;

export function ChatsListScreen({ navigation }: Props) {
  const { colors, spacing } = useTheme();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);

  const query = useConversations({ search: debouncedSearch || undefined });
  // Keyed off the query data (stable identity from react-query) rather than
  // the freshly-allocated array flatten returns, so the list only rebuilds
  // when the conversations actually change.
  const conversations = useMemo(() => flattenConversations(query.data), [query.data]);
  const pinConversation = usePinConversation();
  const archiveConversation = useArchiveConversation();

  // Stable per-row callbacks — inline arrows would change identity every
  // render and defeat ChatListItem's React.memo.
  const handleOpen = useCallback(
    (conversation: Conversation) => navigation.navigate('ConversationDetail', { conversationId: conversation.id }),
    [navigation],
  );
  const handleTogglePin = useCallback(
    (conversation: Conversation) => pinConversation.mutate({ id: conversation.id, pinned: !conversation.pinned }),
    [pinConversation],
  );
  const handleArchive = useCallback(
    (conversation: Conversation) => archiveConversation.mutate({ id: conversation.id, status: 'ARCHIVED' }),
    [archiveConversation],
  );

  const renderItem = useCallback(
    ({ item }: { item: Conversation }) => (
      <ChatListItem
        conversation={item}
        onPress={handleOpen}
        onTogglePin={handleTogglePin}
        onArchive={handleArchive}
      />
    ),
    [handleOpen, handleTogglePin, handleArchive],
  );

  const showSkeleton = query.isLoading;
  const showEmpty = !showSkeleton && conversations.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search chats" />

      {showSkeleton ? (
        <ChatListSkeleton />
      ) : showEmpty ? (
        <EmptyState
          icon={debouncedSearch ? 'search-outline' : 'chatbubbles-outline'}
          title={debouncedSearch ? 'No chats match your search' : 'No conversations yet'}
          subtitle={debouncedSearch ? 'Try a different name or number.' : 'New conversations will show up here as customers message in.'}
        />
      ) : (
        <FlashList
          data={conversations}
          keyExtractor={(item: Conversation) => item.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => (
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginLeft: 84 }} />
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
