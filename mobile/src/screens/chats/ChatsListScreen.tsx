import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SearchBar } from '../../components/SearchBar';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import { ChatListSkeleton } from '../../components/Skeleton';
import { EmptyState } from '../../components/EmptyState';
import { ChatListItem } from './ChatListItem';
import { NewChatSheet } from './NewChatSheet';
import { ChatActionSheet } from './ChatActionSheet';
import {
  useConversations,
  flattenConversations,
  usePinConversation,
  useArchiveConversation,
  useDeleteConversation,
} from '../../queries/useConversations';
import { useDebouncedValue } from '../../utils/useDebouncedValue';
import { useTheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';
import type { ChatsStackParamList } from '../../navigation/types';
import type { Conversation } from '../../api/types';

type Props = NativeStackScreenProps<ChatsStackParamList, 'ChatsList'>;

export function ChatsListScreen({ navigation }: Props) {
  const { colors, spacing, radius, typography, shadow } = useTheme();
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<Conversation | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);

  // The status filter was never sent, and the backend only filters when it
  // receives one (conversation.repository.ts) — so archiving set a field
  // nothing read and the chat stayed in the list. Now the list asks for one
  // side or the other, which is what makes Archive actually do something.
  const query = useConversations({
    search: debouncedSearch || undefined,
    status: showArchived ? 'ARCHIVED' : 'OPEN',
  });
  // Keyed off the query data (stable identity from react-query) rather than
  // the freshly-allocated array flatten returns, so the list only rebuilds
  // when the conversations actually change.
  const conversations = useMemo(() => flattenConversations(query.data), [query.data]);
  const pinConversation = usePinConversation();
  const archiveConversation = useArchiveConversation();
  const deleteConversation = useDeleteConversation();

  // Stable per-row callbacks — inline arrows would change identity every
  // render and defeat ChatListItem's React.memo.
  const handleOpen = useCallback(
    (conversation: Conversation) => navigation.navigate('ConversationDetail', { conversationId: conversation.id }),
    [navigation],
  );
  const handleLongPress = useCallback((conversation: Conversation) => setActionTarget(conversation), []);

  const handleTogglePin = useCallback(
    (conversation: Conversation) => {
      pinConversation.mutate({ id: conversation.id, pinned: !conversation.pinned });
      setActionTarget(null);
    },
    [pinConversation],
  );
  // One button, both directions: archive from the open list, restore from
  // the archived one.
  const handleArchive = useCallback(
    (conversation: Conversation) => {
      archiveConversation.mutate({
        id: conversation.id,
        status: conversation.status === 'ARCHIVED' ? 'OPEN' : 'ARCHIVED',
      });
      setActionTarget(null);
    },
    [archiveConversation],
  );

  const handleDelete = useCallback(
    (conversation: Conversation) => {
      const label = conversation.contact?.name || conversation.contact?.phone || 'this chat';
      setActionTarget(null);
      Alert.alert(
        'Delete chat?',
        `This removes ${label} and its messages from VOXO. It cannot remove anything from the customer's own WhatsApp.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => deleteConversation.mutate(conversation.id) },
        ],
      );
    },
    [deleteConversation],
  );

  const renderItem = useCallback(
    ({ item }: { item: Conversation }) => (
      <ChatListItem conversation={item} onPress={handleOpen} onLongPress={handleLongPress} />
    ),
    [handleOpen, handleLongPress],
  );

  const showSkeleton = query.isLoading;
  const showEmpty = !showSkeleton && conversations.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SearchBar value={search} onChangeText={setSearch} placeholder={showArchived ? 'Search archived' : 'Search chats'} />

      <Pressable
        onPress={() => setShowArchived((prev) => !prev)}
        style={[styles.archiveToggle, { paddingHorizontal: spacing.md, marginBottom: spacing.xs }]}
        accessibilityRole="button"
        accessibilityLabel={showArchived ? 'Back to active chats' : 'Show archived chats'}
      >
        {({ pressed }) => (
          <View
            style={[
              styles.archiveToggleInner,
              {
                backgroundColor: showArchived ? colors.primaryMuted : 'transparent',
                borderRadius: radius.md,
                paddingHorizontal: spacing.sm,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <Ionicons
              name={showArchived ? 'chevron-back' : 'archive-outline'}
              size={17}
              color={showArchived ? colors.primary : colors.textSecondary}
            />
            <Text
              style={[
                typography.label,
                { color: showArchived ? colors.primary : colors.textSecondary, marginLeft: spacing.xs },
              ]}
            >
              {showArchived ? 'Back to chats' : 'Archived'}
            </Text>
          </View>
        )}
      </Pressable>

      <ConnectionBanner />

      {showSkeleton ? (
        <ChatListSkeleton />
      ) : showEmpty ? (
        <EmptyState
          icon={debouncedSearch ? 'search-outline' : showArchived ? 'archive-outline' : 'chatbubbles-outline'}
          title={
            debouncedSearch
              ? 'No chats match your search'
              : showArchived
                ? 'Nothing archived'
                : 'No conversations yet'
          }
          subtitle={
            debouncedSearch
              ? 'Try a different name or number.'
              : showArchived
                ? 'Chats you archive will be kept here.'
                : 'New conversations will show up here as customers message in.'
          }
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

      {/* New chat: pick a contact and the thread opens (creating it the
          first time). This is the only entry point now that the Contacts
          tab is gone, so it also offers adding a contact. */}
      {!showArchived ? (
        <Pressable
          onPress={() => setNewChatOpen(true)}
          style={[styles.fab, shadow.lg, { backgroundColor: colors.primary, borderRadius: radius.full, bottom: spacing.lg }]}
          accessibilityRole="button"
          accessibilityLabel="Start a new chat"
        >
          {({ pressed }) => <Ionicons name="add" size={28} color={colors.textOnPrimary} style={{ opacity: pressed ? 0.6 : 1 }} />}
        </Pressable>
      ) : null}

      <ChatActionSheet
        conversation={actionTarget}
        onClose={() => setActionTarget(null)}
        onTogglePin={handleTogglePin}
        onToggleArchive={handleArchive}
        onDelete={handleDelete}
      />

      <NewChatSheet
        visible={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onOpenConversation={(conversationId) => {
          setNewChatOpen(false);
          navigation.navigate('ConversationDetail', { conversationId });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  archiveToggle: { minHeight: touchTarget.compact, justifyContent: 'center' },
  archiveToggleInner: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', minHeight: 32 },
  fab: { position: 'absolute', right: 20, width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
});
