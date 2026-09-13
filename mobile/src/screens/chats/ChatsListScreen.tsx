import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SearchBar } from '../../components/SearchBar';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import { NumberHealthBanner } from '../../components/NumberHealthBanner';
import { ChatListSkeleton } from '../../components/Skeleton';
import { EmptyState } from '../../components/EmptyState';
import { ChatListItem } from './ChatListItem';
import { NewChatSheet } from './NewChatSheet';
import { ChatActionSheet } from './ChatActionSheet';
import { ChatSelectionBar } from './ChatSelectionBar';
import { LiveNowSheet } from './LiveNowSheet';
import {
  useConversations,
  flattenConversations,
  usePinConversation,
  useArchiveConversation,
  useDeleteConversation,
  useMarkConversationUnread,
  useBulkConversations,
} from '../../queries/useConversations';
import { useGuestPresenceStore } from '../../store/guestPresenceStore';
import { useTabBadges } from '../../queries/useTabBadges';
import { useDebouncedValue } from '../../utils/useDebouncedValue';
import { ThemeProvider, useTheme, useResolvedScheme } from '../../theme/ThemeProvider';
import { chatLightColors, chatDarkColors, chatListBackground } from '../../theme/chatTheme';
import { ChatListFilters, type ChatFilter } from './ChatListFilters';
import { touchTarget } from '../../theme/spacing';
import type { ChatsStackParamList } from '../../navigation/types';
import { impactMedium, selectionFeedback } from '../../utils/haptics';
import type { Conversation } from '../../api/types';

type Props = NativeStackScreenProps<ChatsStackParamList, 'ChatsList'>;

/** Module scope: a stable identity FlashList can rely on across renders. */
const keyExtractor = (item: Conversation) => item.id;

/**
 * The inbox wears the same palette as the conversation it opens.
 *
 * The two screens are one place to the person using them, and the list
 * kept the app's indigo while the chat had already moved to the
 * messenger's greens — so opening a chat changed the colour of the
 * product. Scoped to this subtree exactly as the chat screen scopes its
 * own, and still following the app's light/dark/system setting.
 */
export function ChatsListScreen(props: Props) {
  const scheme = useResolvedScheme();
  const chatColors = useMemo(() => {
    const base = scheme === 'dark' ? chatDarkColors : chatLightColors;
    // The inbox is not the conversation: it does not sit on the
    // wallpaper. Overridden here rather than in chatTheme itself so the
    // conversation screen keeps the ground it wants.
    return { ...base, background: chatListBackground[scheme === 'dark' ? 'dark' : 'light'] };
  }, [scheme]);
  return (
    <ThemeProvider colors={chatColors}>
      <ChatsListScreenInner {...props} />
    </ThemeProvider>
  );
}

function ChatsListScreenInner({ navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState<ChatFilter>('all');
  // The same figure the Chats tab badge shows, off the same cache entry —
  // two counts of the same thing that disagreed would be worse than one.
  const { unreadChats } = useTabBadges();
  const [liveOpen, setLiveOpen] = useState(false);
  /**
   * How many customers have their private chat window open right now.
   *
   * Selected down to a NUMBER rather than subscribing to the map: this
   * screen re-renders a list of forty rows, and it should do that when
   * the count changes, not every time any one customer's dot flickers.
   */
  const liveCount = useGuestPresenceStore((s) => Object.keys(s.open).length);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<Conversation | null>(null);
  // Multi-select. Held as an id array rather than a Set so it stays a plain
  // value React can compare — a mutated Set would not re-render the rows.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionMode = selectedIds.length > 0;
  const debouncedSearch = useDebouncedValue(search, 300);

  // The status filter was never sent, and the backend only filters when it
  // receives one (conversation.repository.ts) — so archiving set a field
  // nothing read and the chat stayed in the list. Now the list asks for one
  // side or the other, which is what makes Archive actually do something.
  const query = useConversations({
    search: debouncedSearch || undefined,
    status: showArchived ? 'ARCHIVED' : 'OPEN',
    // Sent to the server rather than applied to the loaded pages: filtering
    // after the fetch returns short pages and a cursor that has already
    // walked past the rows it hid.
    unread: filter === 'all' ? undefined : filter === 'unread',
  });
  // Keyed off the query data (stable identity from react-query) rather than
  // the freshly-allocated array flatten returns, so the list only rebuilds
  // when the conversations actually change.
  const conversations = useMemo(() => flattenConversations(query.data), [query.data]);
  const pinConversation = usePinConversation();
  const archiveConversation = useArchiveConversation();
  const deleteConversation = useDeleteConversation();
  const markUnread = useMarkConversationUnread();
  const bulkConversations = useBulkConversations();

  // Stable per-row callbacks — inline arrows would change identity every
  // render and defeat ChatListItem's React.memo.
  const toggleSelected = useCallback((conversation: Conversation) => {
    selectionFeedback();
    setSelectedIds((prev) =>
      prev.includes(conversation.id) ? prev.filter((id) => id !== conversation.id) : [...prev, conversation.id],
    );
  }, []);

  const clearSelection = useCallback(() => setSelectedIds([]), []);

  const handleOpen = useCallback(
    (conversation: Conversation) => {
      // While selecting, a tap toggles the row rather than leaving the
      // screen — the same rule the message list uses.
      if (selectionMode) {
        toggleSelected(conversation);
        return;
      }
      navigation.navigate('ConversationDetail', { conversationId: conversation.id });
    },
    [navigation, selectionMode, toggleSelected],
  );

  const handleLongPress = useCallback(
    (conversation: Conversation) => {
      // Long-pressing during a selection extends it instead of opening a
      // single-chat sheet whose actions would contradict the selection.
      if (selectionMode) {
        toggleSelected(conversation);
        return;
      }
      // Same reasoning as the message bubble: a long press has no visual
      // feedback of its own until the sheet arrives.
      impactMedium();
      setActionTarget(conversation);
    },
    [selectionMode, toggleSelected],
  );

  const handleMarkUnread = useCallback(
    (conversation: Conversation) => {
      setActionTarget(null);
      markUnread.mutate(conversation.id);
    },
    [markUnread],
  );

  const handleStartSelection = useCallback((conversation: Conversation) => {
    setActionTarget(null);
    setSelectedIds([conversation.id]);
  }, []);

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

  const runBulk = useCallback(
    (action: 'archive' | 'unarchive' | 'delete' | 'read') => {
      const ids = selectedIds;
      bulkConversations.mutate(
        { ids, action },
        {
          onSuccess: (result) => {
            clearSelection();
            // Reports what actually changed rather than what was asked for:
            // a chat someone else deleted meanwhile is skipped, and saying
            // "20 archived" when 18 were would be a quiet lie.
            if (result.affected < ids.length) {
              Alert.alert(
                'Partly applied',
                `${result.affected} of ${ids.length} chats were updated. The rest were already gone.`,
              );
            }
          },
        },
      );
    },
    [bulkConversations, selectedIds, clearSelection],
  );

  const confirmBulkDelete = useCallback(() => {
    const count = selectedIds.length;
    Alert.alert(
      `Delete ${count} ${count === 1 ? 'chat' : 'chats'}?`,
      "This removes them and their messages from VOXO. It cannot remove anything from the customers' own WhatsApp.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => runBulk('delete') },
      ],
    );
  }, [selectedIds.length, runBulk]);

  const renderItem = useCallback(
    ({ item }: { item: Conversation }) => (
      <ChatListItem
        conversation={item}
        onPress={handleOpen}
        onLongPress={handleLongPress}
        selectable={selectionMode}
        selected={selectedIds.includes(item.id)}
      />
    ),
    [handleOpen, handleLongPress, selectionMode, selectedIds],
  );

  // Stable identities for everything handed to FlashList. Each of these
  // was an inline literal, which meant a new prop value on every render
  // and a list that could not skip any of the work it had already done.
  const Separator = useCallback(
    () => (
      <View
        style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginLeft: 84 }}
      />
    ),
    [colors.divider],
  );
  const handleEndReached = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);
  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        tintColor={colors.primary}
      />
    ),
    [query, colors.primary],
  );
  const listContentStyle = useMemo(() => ({ paddingBottom: spacing.lg }), [spacing.lg]);

  const showSkeleton = query.isLoading;
  const showEmpty = !showSkeleton && conversations.length === 0;

  return (
    // paddingTop, not a SafeAreaView: the status bar has to be the SAME
    // colour as the header below it, and a wrapper that insets would put
    // the screen background there instead of the header's.
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      {selectionMode ? (
        <ChatSelectionBar
          count={selectedIds.length}
          showingArchived={showArchived}
          busy={bulkConversations.isPending}
          onCancel={clearSelection}
          onMarkRead={() => runBulk('read')}
          onToggleArchive={() => runBulk(showArchived ? 'unarchive' : 'archive')}
          onDelete={confirmBulkDelete}
        />
      ) : (
        <>
          {/* The wordmark, where the messenger puts its own. This screen
              renders its own header now — the navigator's plain "Chats"
              title had no room for a brand, a filter row or the actions
              beside it. */}
          <View style={[styles.brandRow, { paddingHorizontal: spacing.md }]}>
            <Text style={[styles.brand, { color: colors.success }]}>VOXO</Text>
            <View style={styles.brandActions}>
              {/* New chat lives here now, not on a floating button. The
                  FAB sat on top of the list and covered a row's name and
                  timestamp wherever it landed — and this is the only way
                  to start a conversation since the Contacts tab went, so
                  it had to keep a home rather than simply be removed. */}
              {!showArchived ? (
                <Pressable
                  onPress={() => setNewChatOpen(true)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Start a new chat"
                >
                  {({ pressed }) => (
                    <Ionicons
                      name="create-outline"
                      size={22}
                      color={colors.textSecondary}
                      style={{ opacity: pressed ? 0.5 : 1 }}
                    />
                  )}
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => setShowArchived((prev) => !prev)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={showArchived ? 'Back to active chats' : 'Show archived chats'}
              >
                {({ pressed }) => (
                  <Ionicons
                    name={showArchived ? 'chevron-back' : 'archive-outline'}
                    size={22}
                    color={showArchived ? colors.success : colors.textSecondary}
                    style={{ opacity: pressed ? 0.5 : 1 }}
                  />
                )}
              </Pressable>
            </View>
          </View>

          <SearchBar value={search} onChangeText={setSearch} placeholder={showArchived ? 'Search archived' : 'Search chats'} />

          {/* Hidden in the archive, where read and unread are not the
              question being asked. */}
          {!showArchived ? (
            <ChatListFilters value={filter} unreadCount={unreadChats} onChange={setFilter} />
          ) : (
            <View style={[styles.archiveRow, { paddingHorizontal: spacing.md, paddingBottom: spacing.sm }]}>
              <Ionicons name="archive" size={17} color={colors.success} />
              <Text style={[typography.label, { color: colors.success, marginLeft: spacing.xs }]}>Archived</Text>
            </View>
          )}
        </>
      )}

      <ConnectionBanner />
      <NumberHealthBanner />

      {showSkeleton ? (
        <ChatListSkeleton />
      ) : showEmpty ? (
        <EmptyState
          icon={
            debouncedSearch
              ? 'search-outline'
              : showArchived
                ? 'archive-outline'
                : filter === 'unread'
                  ? 'checkmark-done-outline'
                  : 'chatbubbles-outline'
          }
          title={
            debouncedSearch
              ? 'No chats match your search'
              : showArchived
                ? 'Nothing archived'
                : filter === 'unread'
                  ? // The happy emptiness. Reaching zero unread is the
                    // point of the filter, so it should not be reported
                    // in the same words as having no chats at all.
                    'All caught up'
                  : filter === 'read'
                    ? 'Nothing read yet'
                    : 'No conversations yet'
          }
          subtitle={
            debouncedSearch
              ? 'Try a different name or number.'
              : showArchived
                ? 'Chats you archive will be kept here.'
                : filter === 'unread'
                  ? 'Every chat has been read.'
                  : filter === 'read'
                    ? 'Chats you have opened will show up here.'
                    : 'New conversations will show up here as customers message in.'
          }
        />
      ) : (
        <FlashList
          data={conversations}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          // Memoized, not an inline arrow. An arrow here is a NEW COMPONENT
          // TYPE on every render of this screen, so React threw away and
          // rebuilt every separator in the list each time anything changed
          // — a search keystroke, a selection, an incoming message. That is
          // a full unmount/remount cycle per row, for a hairline.
          ItemSeparatorComponent={Separator}
          refreshControl={refreshControl}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          contentContainerStyle={listContentStyle}
        />
      )}

      {/* Where the new-chat button used to be, doing something worth the
          space. These are the only customers a reply reaches while they
          are looking at it, and the only ones who can answer a call.

          Only when there IS someone — a button that opens an empty list
          is worse than no button, and this is also what keeps it from
          sitting on top of a row for no reason, which is what the old one
          did all day. Its appearing is itself the signal. */}
      {!showArchived && liveCount > 0 ? (
        <Pressable
          onPress={() => setLiveOpen(true)}
          style={[styles.fab, { backgroundColor: colors.success, bottom: spacing.lg }]}
          accessibilityRole="button"
          accessibilityLabel={`${liveCount} customer${liveCount === 1 ? '' : 's'} in the chat window now`}
        >
          {({ pressed }) => (
            <View style={[styles.fabInner, { opacity: pressed ? 0.7 : 1 }]}>
              <Ionicons name="pulse" size={26} color={colors.textOnPrimary} />
              <View style={[styles.fabCount, { backgroundColor: colors.textOnPrimary }]}>
                <Text style={[typography.caption, styles.fabCountText, { color: colors.success }]}>
                  {liveCount > 9 ? '9+' : liveCount}
                </Text>
              </View>
            </View>
          )}
        </Pressable>
      ) : null}

      <LiveNowSheet
        visible={liveOpen}
        onClose={() => setLiveOpen(false)}
        onOpenConversation={(conversationId) => {
          setLiveOpen(false);
          navigation.navigate('ConversationDetail', { conversationId });
        }}
      />

      <ChatActionSheet
        conversation={actionTarget}
        onClose={() => setActionTarget(null)}
        onTogglePin={handleTogglePin}
        onToggleArchive={handleArchive}
        onDelete={handleDelete}
        onMarkUnread={handleMarkUnread}
        onSelect={handleStartSelection}
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
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: touchTarget.compact,
    paddingTop: 6,
  },
  // 25/700 with a tight track: the messenger's wordmark is the largest
  // thing on the screen and the only place this weight appears, which is
  // what makes it read as a name rather than a heading.
  brand: { fontSize: 25, fontWeight: '700', letterSpacing: -0.4 },
  archiveRow: { flexDirection: 'row', alignItems: 'center' },
  brandActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  // Same size, same corner, same circle the new-chat button had.
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabInner: { alignItems: 'center', justifyContent: 'center' },
  fabCount: {
    position: 'absolute',
    top: -12,
    right: -14,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabCountText: { fontWeight: '700', fontSize: 11 },
});
