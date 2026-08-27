import React, { useState } from 'react';
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
  const conversations = flattenConversations(query.data);
  const pinConversation = usePinConversation();
  const archiveConversation = useArchiveConversation();

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
          renderItem={({ item }: { item: Conversation }) => (
            <ChatListItem
              conversation={item}
              onPress={() => navigation.navigate('ConversationDetail', { conversationId: item.id })}
              onTogglePin={() => pinConversation.mutate({ id: item.id, pinned: !item.pinned })}
              onArchive={() => archiveConversation.mutate({ id: item.id, status: 'ARCHIVED' })}
            />
          )}
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
