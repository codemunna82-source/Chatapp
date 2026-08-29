import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { Screen } from '../../components/Screen';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { InlineBanner } from '../../components/InlineBanner';
import { MessageBubble } from './MessageBubble';
import { ChatWallpaper } from './ChatWallpaper';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import { DateSeparator } from './DateSeparator';
import { TypingIndicator } from './TypingIndicator';
import { Composer } from './Composer';
import { ReplyPreviewBar } from './ReplyPreviewBar';
import { MessageActionSheet } from './MessageActionSheet';
import { TemplatePickerSheet } from './TemplatePickerSheet';
import { ChatHeaderTitle } from './ChatHeaderTitle';
import { MessageInfoSheet } from './MessageInfoSheet';
import { ScrollToBottomButton } from './ScrollToBottomButton';
import { AttachmentSheet } from './AttachmentSheet';
import { ForwardSheet, buildForwardBody } from './ForwardSheet';
import { ImageViewerModal } from './ImageViewerModal';
import { deriveConversationView } from './deriveConversationView';
import { useConversation } from '../../queries/useConversations';
import {
  useMessages,
  flattenMessages,
  useSendMessage,
  useDeleteMessage,
  useStarMessage,
  useFilteredMessages,
  removeMessageFromCache,
} from '../../queries/useMessages';
import { useConversationRoom } from '../../sockets/useConversationRoom';
import { useSocketEvent } from '../../sockets/useSocketEvent';
import { emitConversationRead } from '../../sockets/actions';
import { useSocketConnection } from '../../sockets/useSocketConnected';
import { useDebouncedValue } from '../../utils/useDebouncedValue';
import { MessageSearchPanel } from './MessageSearchPanel';
import { useActiveConversationStore } from '../../store/activeConversationStore';
import { usePlaceCall } from '../../queries/useCalls';
import { getApiErrorMessage } from '../../api/client';
import * as Clipboard from 'expo-clipboard';
import { ThemeProvider, useResolvedScheme } from '../../theme/ThemeProvider';
import { touchTarget } from '../../theme/spacing';
import { chatLightColors, chatDarkColors, chatHeaderBackground } from '../../theme/chatTheme';
import { dayKey } from '../../utils/formatTime';
import type { Edge } from 'react-native-safe-area-context';
import type { ChatsStackParamList } from '../../navigation/types';
import type { Message } from '../../api/types';
import type { SendMessageBody } from '../../api/endpoints/messages';

type Props = NativeStackScreenProps<ChatsStackParamList, 'ConversationDetail'>;

type RenderItem = { kind: 'message'; id: string; message: Message } | { kind: 'separator'; id: string; iso: string };

function buildRenderItems(renderableNewestFirst: Message[]): RenderItem[] {
  const chronological = [...renderableNewestFirst].reverse();
  const items: RenderItem[] = [];
  let lastDay: string | null = null;
  for (const m of chronological) {
    const day = dayKey(m.createdAt);
    if (day !== lastDay) {
      items.push({ kind: 'separator', id: `sep-${day}`, iso: m.createdAt });
      lastDay = day;
    }
    items.push({ kind: 'message', id: m.id, message: m });
  }
  return items.reverse();
}

const TYPING_AUTO_CLEAR_MS = 6000;
const SCREEN_EDGES: Edge[] = ['top'];

// Module scope so these never change identity between renders.
const keyExtractor = (item: RenderItem) => item.id;
/** Far enough up that the user is clearly reading history, not just
 *  overscrolling past the newest bubble. */
const SCROLLED_UP_THRESHOLD = 220;

// Lets FlashList recycle separators and bubbles into separate pools instead
// of reusing one cell type for both.
const getItemType = (item: RenderItem) => item.kind;

export function ConversationDetailScreen({ route, navigation }: Props) {
  const { conversationId } = route.params;
  const queryClient = useQueryClient();

  useConversationRoom(conversationId);

  // Tells the alert layer to stay quiet for this chat while it is on
  // screen — see useMessageAlert. Cleared on unmount so backing out to the
  // list restores the chime for it.
  useEffect(() => {
    const { setActiveConversation } = useActiveConversationStore.getState();
    setActiveConversation(conversationId);
    return () => setActiveConversation(null);
  }, [conversationId]);

  const conversationQuery = useConversation(conversationId);
  const messagesQuery = useMessages(conversationId);
  const sendMessage = useSendMessage(conversationId);
  const deleteMessage = useDeleteMessage(conversationId);
  const starMessage = useStarMessage(conversationId);

  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [actionTarget, setActionTarget] = useState<Message | null>(null);
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const [templateSheetOpen, setTemplateSheetOpen] = useState(false);
  // Multi-select: long-press enters selection mode, tap toggles rows, and
  // the header turns into a selection bar with a forward action.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [forwardTargets, setForwardTargets] = useState<Message[]>([]);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  // Short-lived confirmation for copy/forward — both are silent otherwise.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const typingClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { placeCall, isPending: callPending, apiError: callApiError, linkError: callLinkError } = usePlaceCall();
  const callError = callApiError ? getApiErrorMessage(callApiError, 'Could not start that call.') : callLinkError;
  const contactId = conversationQuery.data?.contactId;

  // Fixed navy+gold look for this screen, in a light and a dark variant —
  // matches the requested reference design — but unlike the earlier
  // crimson version, it now follows Settings' own light/dark/system
  // preference like every other screen instead of forcing one look.
  const scheme = useResolvedScheme();
  const chatColors = scheme === 'dark' ? chatDarkColors : chatLightColors;

  // Keyboard avoidance, take two. KeyboardAvoidingView did not work here:
  // this app runs edge-to-edge (targetSdk 36), where Android stops resizing
  // the window for the IME and RN's JS-side keyboard events are unreliable,
  // so the composer stayed pinned under the keyboard. Reanimated's
  // useAnimatedKeyboard reads the IME inset straight off WindowInsets on
  // the UI thread, which is the one source that stays correct under
  // edge-to-edge.
  //
  // One expression covers both states: while the keyboard is up the pad is
  // its height, and while it is down the pad falls back to the navigation
  // bar inset. That also removes the stacked-inset problem - the two can
  // never add together into a dead gap above the keyboard.
  const keyboard = useAnimatedKeyboard();
  const insets = useSafeAreaInsets();
  const keyboardPadStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(keyboard.height.value, insets.bottom),
  }));



  useSocketEvent<{ conversationId: string; userId: string }>(
    'typing:start',
    (payload) => {
      if (payload.conversationId !== conversationId) return;
      setIsTyping(true);
      if (typingClearTimer.current) clearTimeout(typingClearTimer.current);
      typingClearTimer.current = setTimeout(() => setIsTyping(false), TYPING_AUTO_CLEAR_MS);
    },
    [conversationId],
  );
  useSocketEvent<{ conversationId: string; userId: string }>(
    'typing:stop',
    (payload) => {
      if (payload.conversationId !== conversationId) return;
      setIsTyping(false);
      if (typingClearTimer.current) clearTimeout(typingClearTimer.current);
    },
    [conversationId],
  );

  // flattenMessages() allocates a fresh array, so keying the memos below off
  // its result meant they recomputed on EVERY render — re-deriving reactions
  // and reply targets for the whole conversation, and rebuilding the date
  // separators, whenever anything unrelated changed (a typing indicator, a
  // toast, a keystroke). Key off the query data itself, whose identity
  // react-query only changes when the messages actually change.
  const messages = useMemo(() => flattenMessages(messagesQuery.data), [messagesQuery.data]);

  // --- in-chat search / starred ------------------------------------------
  const [infoTarget, setInfoTarget] = useState<Message | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [starredOnly, setStarredOnly] = useState(false);
  // Debounced so a five-letter word is one query, not five.
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300);
  const searchQuery = useFilteredMessages(conversationId, {
    search: debouncedSearch || undefined,
    starredOnly: starredOnly || undefined,
  });
  const searchResults = useMemo(() => flattenMessages(searchQuery.data), [searchQuery.data]);


  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchInput('');
    setStarredOnly(false);
  }, []);

  // --- scroll-to-bottom + new-message count --------------------------------
  // The list is inverted, so "at the bottom" is scroll offset ~0.
  const listRef = useRef<FlashListRef<RenderItem>>(null);
  // The newest message at the moment the user scrolled away from the bottom.
  // Storing an anchor rather than a counter means the count is derived from
  // the list itself, so it cannot drift out of sync with what is rendered —
  // and it is set from a scroll event rather than written back by an effect.
  const [anchorMessageId, setAnchorMessageId] = useState<string | null>(null);
  const [scrolledUp, setScrolledUp] = useState(false);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const away = e.nativeEvent.contentOffset.y > SCROLLED_UP_THRESHOLD;
      setScrolledUp((wasAway) => {
        if (away && !wasAway) setAnchorMessageId(messages[0]?.id ?? null);
        if (!away && wasAway) setAnchorMessageId(null);
        return away;
      });
    },
    [messages],
  );

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setAnchorMessageId(null);
  }, []);

  // messages is newest-first, so the anchor's index IS how many arrived
  // after it. -1 (anchor paged out or was deleted) means don't guess.
  const newSinceAnchor = useMemo(() => {
    if (!anchorMessageId) return 0;
    const idx = messages.findIndex((m) => m.id === anchorMessageId);
    return idx > 0 ? idx : 0;
  }, [messages, anchorMessageId]);

  // Re-sent on every reconnect and on every incoming message, not just at
  // mount. Two ways the old mount-only version left a stale unread badge:
  // the socket may not have been connected yet when the screen opened, and
  // a message arriving while the user is sitting in the chat bumps the
  // server's unreadCount again — with nothing to clear it, backing out
  // showed unread messages the user had just watched arrive.
  const { connected, generation } = useSocketConnection();
  const lastIncomingId = messages.find((m) => m.direction === 'IN')?.id;
  useEffect(() => {
    if (!connected) return;
    emitConversationRead(conversationId);
  }, [conversationId, connected, generation, lastIncomingId]);
  const view = useMemo(() => deriveConversationView(messages), [messages]);
  const renderItems = useMemo(() => buildRenderItems(view.renderable), [view.renderable]);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  /**
   * Jumps to a result when it is already loaded in the thread. When it is
   * not, the panel says so rather than pretending: fetching backwards until
   * a match appears could be many round trips on a long conversation, and a
   * button that silently does nothing is worse than one that explains.
   */
  const handleSelectSearchResult = useCallback(
    (message: Message) => {
      const index = renderItems.findIndex((item) => item.kind === 'message' && item.message.id === message.id);
      if (index === -1) {
        showToast('Older message — scroll up in the chat to load it');
        return;
      }
      setSearchOpen(false);
      setSearchInput('');
      setStarredOnly(false);
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showToast is a stable useCallback defined below
    [renderItems],
  );

  const submitSend = useCallback(
    (body: SendMessageBody) => {
      sendMessage.mutate(body);
      setReplyingTo(null);
    },
    [sendMessage],
  );

  const handleSendText = useCallback(
    (text: string) => {
      submitSend({ type: 'text', text, replyToMessageId: replyingTo?.id });
    },
    [submitSend, replyingTo],
  );

  const handleRetry = useCallback(
    (message: Message) => {
      removeMessageFromCache(queryClient, conversationId, message.id);
      if (message.type === 'text') {
        submitSend({ type: 'text', text: message.text ?? '', replyToMessageId: message.replyToMessageId });
      } else if (
        (message.type === 'image' || message.type === 'video' || message.type === 'audio' || message.type === 'document') &&
        message.mediaId
      ) {
        submitSend({ type: message.type, mediaId: message.mediaId, replyToMessageId: message.replyToMessageId });
      }
      // Template/reaction retries need fields the Message type doesn't
      // carry back (template name/language, target id) — the user can
      // just re-send those from scratch, which is a minor UX gap, not a
      // silent failure (the FAILED bubble stays visible either way).
    },
    [conversationId, queryClient, submitSend],
  );

  const canReactTo = (message: Message) => !message.id.startsWith('temp-') && message.status !== 'FAILED';

  // Stable identities: an inline arrow per row would change every render and
  // defeat MessageBubble's React.memo, re-rendering every bubble in the list.
  const selectionMode = selectedIds.length > 0;

  const toggleSelected = useCallback((message: Message) => {
    setSelectedIds((prev) =>
      prev.includes(message.id) ? prev.filter((id) => id !== message.id) : [...prev, message.id],
    );
  }, []);

  const clearSelection = useCallback(() => setSelectedIds([]), []);

  // In selection mode a long-press just toggles, so the action sheet can't
  // open on top of a selection the user is still building.
  // Long-press opens the action sheet (react / reply / forward / copy).
  // It briefly started a selection instead, which made those actions
  // unreachable on any forwardable message — multi-select is now entered
  // from the sheet's own "Select more" row.
  const handleLongPress = useCallback(
    (message: Message) => {
      if (selectionMode) {
        toggleSelected(message);
        return;
      }
      setActionTarget(message);
    },
    [selectionMode, toggleSelected],
  );

  const handleSelectTap = useCallback(
    (message: Message) => {
      if (selectionMode) toggleSelected(message);
    },
    [selectionMode, toggleSelected],
  );

  const handleReply = useCallback((message: Message) => setReplyingTo(message), []);
  const handleForwardOne = useCallback((message: Message) => setForwardTargets([message]), []);

  const forwardSelected = useCallback(() => {
    // Preserve conversation order rather than tap order.
    const ordered = view.renderable.filter((m) => selectedIds.includes(m.id)).reverse();
    setForwardTargets(ordered);
  }, [view.renderable, selectedIds]);

  useEffect(() => {
    if (searchOpen) {
      // Search takes over the header, which is also the only way out of the
      // panel — it covers the thread, so without this there is no exit.
      navigation.setOptions({
        title: 'Search in chat',
        headerTitle: undefined,
        headerStyle: { backgroundColor: chatHeaderBackground },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { color: '#FFFFFF' },
        headerRight: () => null,
        headerLeft: () => (
          <Pressable
            onPress={closeSearch}
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityLabel="Close search"
          >
            {({ pressed }) => <Ionicons name="close" size={24} color="#FFFFFF" style={{ opacity: pressed ? 0.5 : 1 }} />}
          </Pressable>
        ),
      });
      return;
    }

    if (selectionMode) {
      // Selection bar replaces the normal header: count on the left, a
      // close and a forward action on the right.
      navigation.setOptions({
        title: `${selectedIds.length} selected`,
        // Explicitly cleared: a custom headerTitle set on the previous pass
        // would otherwise survive and keep showing the contact name here.
        headerTitle: undefined,
        headerStyle: { backgroundColor: chatHeaderBackground },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { color: '#FFFFFF' },
        headerLeft: () => (
          <Pressable
            onPress={clearSelection}
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityLabel="Cancel selection"
          >
            {({ pressed }) => <Ionicons name="close" size={24} color="#FFFFFF" style={{ opacity: pressed ? 0.5 : 1 }} />}
          </Pressable>
        ),
        headerRight: () => (
          <Pressable
            onPress={forwardSelected}
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityLabel={`Forward ${selectedIds.length} selected messages`}
          >
            {({ pressed }) => (
              <Ionicons name="arrow-redo" size={22} color="#FFFFFF" style={{ opacity: pressed ? 0.5 : 1 }} />
            )}
          </Pressable>
        ),
      });
      return;
    }

    const contactLabel =
      conversationQuery.data?.contact?.name || conversationQuery.data?.contact?.phone || 'Conversation';
    navigation.setOptions({
      headerLeft: undefined,
      title: contactLabel,
      // Replaces the plain title so the 24-hour reply window is visible
      // while it still matters, instead of only surfacing as a rejected
      // send once it has already closed.
      headerTitle: () => (
        <ChatHeaderTitle
          name={contactLabel}
          windowExpiresAt={conversationQuery.data?.conversationWindowExpiresAt}
          withinWindow={conversationQuery.data?.withinCustomerServiceWindow ?? true}
        />
      ),
      // The header itself stays a fixed navy in both schemes (matches both
      // reference images identically) — hardcoded rather than theme-driven
      // since headerStyle/headerTintColor render through React Navigation's
      // own header, outside the nested <ThemeProvider colors={chatColors}>
      // wrap below (that only covers this component's own returned JSX).
      headerStyle: { backgroundColor: chatHeaderBackground },
      headerTintColor: '#FFFFFF',
      headerTitleStyle: { color: '#FFFFFF' },
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => setSearchOpen(true)}
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityLabel="Search in this chat"
          >
            {({ pressed }) => (
              <Ionicons name="search" size={21} color="#FFFFFF" style={{ opacity: pressed ? 0.5 : 1 }} />
            )}
          </Pressable>
          {contactId ? (
          <Pressable
            onPress={() => placeCall(contactId)}
            disabled={callPending}
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityState={{ disabled: callPending }}
            accessibilityLabel="Call this contact"
          >
            {({ pressed }) => (
              <Ionicons
                name="call-outline"
                size={22}
                color={callPending ? 'rgba(255,255,255,0.5)' : '#FFFFFF'}
                style={{ opacity: pressed ? 0.5 : 1 }}
              />
            )}
          </Pressable>
          ) : null}
        </View>
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- placeCall is a stable closure from usePlaceCall; including it would re-run this on every render
  }, [
    navigation,
    conversationQuery.data,
    contactId,
    callPending,
    selectionMode,
    selectedIds.length,
    clearSelection,
    forwardSelected,
    searchOpen,
    closeSearch,
  ]);
  const handleOpenImage = useCallback((localUri: string) => setViewerUri(localUri), []);

  useEffect(
    () => () => {
      // Both timers must die with the screen — a pending typing-clear or
      // toast timer would otherwise fire setState on an unmounted component.
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (typingClearTimer.current) clearTimeout(typingClearTimer.current);
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    const target = actionTarget;
    setActionTarget(null);
    if (!target?.text) return;
    await Clipboard.setStringAsync(target.text);
    showToast('Copied to clipboard');
  }, [actionTarget, showToast]);

  const conversation = conversationQuery.data;

  // Hoisted out of the JSX: an inline renderItem is a new function every
  // render, which makes FlashList re-render every visible row.
  const renderItem = useCallback(
    ({ item }: { item: RenderItem }) =>
      item.kind === 'separator' ? (
        <DateSeparator iso={item.iso} />
      ) : (
        <MessageBubble
          message={item.message}
          replyTarget={item.message.replyToMessageId ? view.messageById.get(item.message.replyToMessageId) : undefined}
          reactions={view.reactionsByTarget.get(item.message.id)}
          onLongPress={handleLongPress}
          onRetry={handleRetry}
          onReply={selectionMode ? undefined : handleReply}
          onForward={selectionMode || !buildForwardBody(item.message) ? undefined : handleForwardOne}
          onOpenImage={selectionMode ? undefined : handleOpenImage}
          selectable={selectionMode}
          selected={selectedIds.includes(item.message.id)}
          onSelectTap={handleSelectTap}
        />
      ),
    [
      view,
      handleLongPress,
      handleRetry,
      handleReply,
      handleForwardOne,
      handleOpenImage,
      selectionMode,
      selectedIds,
      handleSelectTap,
    ],
  );

  const handleEndReached = useCallback(() => {
    if (messagesQuery.hasNextPage && !messagesQuery.isFetchingNextPage) {
      messagesQuery.fetchNextPage();
    }
  }, [messagesQuery]);

  if (messagesQuery.isLoading || conversationQuery.isLoading) {
    return <LoadingIndicator fullscreen />;
  }

  return (
    // Fixed navy+gold look for this screen — see chatTheme.ts. Scoped to
    // this subtree only, and itself following Settings' light/dark/system
    // preference (via chatColors above) same as every other screen does.
    <ThemeProvider colors={chatColors}>
      {/* edges={['top']}: the keyboard-tracking wrapper below owns the
          bottom inset, resolving nav bar and keyboard as a single value. */}
      <Screen padded={false} edges={SCREEN_EDGES}>
        <Animated.View style={[styles.flex, keyboardPadStyle]}>
          <View style={styles.flex}>
            <ChatWallpaper />
            <ConnectionBanner />
            {callError ? (
              <View style={styles.callErrorWrap}>
                <InlineBanner message={callError} />
              </View>
            ) : null}
            <FlashList
              ref={listRef}
              data={renderItems}
              inverted
              keyExtractor={keyExtractor}
              getItemType={getItemType}
              renderItem={renderItem}
              onEndReached={handleEndReached}
              onEndReachedThreshold={0.5}
              onScroll={handleScroll}
              scrollEventThrottle={64}
              ListHeaderComponent={isTyping ? <TypingIndicator /> : null}
              contentContainerStyle={styles.listContent}
            />

            <ScrollToBottomButton visible={scrolledUp} newCount={newSinceAnchor} onPress={scrollToBottom} />

            {searchOpen ? (
              <MessageSearchPanel
                search={searchInput}
                onChangeSearch={setSearchInput}
                starredOnly={starredOnly}
                onToggleStarredOnly={() => setStarredOnly((v) => !v)}
                results={searchResults}
                loading={searchQuery.isFetching}
                searched={Boolean(debouncedSearch || starredOnly)}
                onSelect={handleSelectSearchResult}
                onEndReached={() => {
                  if (searchQuery.hasNextPage && !searchQuery.isFetchingNextPage) {
                    void searchQuery.fetchNextPage();
                  }
                }}
              />
            ) : null}

            {replyingTo ? <ReplyPreviewBar target={replyingTo} onCancel={() => setReplyingTo(null)} /> : null}

            <Composer
              conversationId={conversationId}
              whatsappPhoneNumberId={conversation?.whatsappPhoneNumberId}
              withinWindow={conversation?.withinCustomerServiceWindow ?? false}
              sending={sendMessage.isPending}
              onSendText={handleSendText}
              onAttach={() => setAttachSheetOpen(true)}
              onUseTemplate={() => setTemplateSheetOpen(true)}
              replyToMessageId={replyingTo?.id}
              onSent={() => setReplyingTo(null)}
            />
          </View>
        </Animated.View>

        <MessageInfoSheet message={infoTarget} onClose={() => setInfoTarget(null)} />

        <MessageActionSheet
          visible={Boolean(actionTarget)}
          canReact={Boolean(actionTarget && canReactTo(actionTarget))}
          canCopy={Boolean(actionTarget?.text)}
          canForward={Boolean(actionTarget && buildForwardBody(actionTarget))}
          onClose={() => setActionTarget(null)}
          onCopy={handleCopy}
          canSelect={Boolean(actionTarget && buildForwardBody(actionTarget))}
          // Outgoing only, and never an optimistic row: a message that has
          // not reached the server has no delivery milestones to show.
          canShowInfo={Boolean(
            actionTarget && actionTarget.direction === 'OUT' && !actionTarget.id.startsWith('temp-'),
          )}
          onShowInfo={() => {
            setInfoTarget(actionTarget);
            setActionTarget(null);
          }}
          starred={Boolean(actionTarget?.starredAt)}
          // A reaction isn't a message anyone bookmarks, and an optimistic
          // row has no server id to star against yet.
          canStar={Boolean(actionTarget && actionTarget.type !== 'reaction' && !actionTarget.id.startsWith('temp-'))}
          onToggleStar={() => {
            const target = actionTarget;
            setActionTarget(null);
            if (!target) return;
            starMessage.mutate(
              { messageId: target.id, starred: !target.starredAt },
              { onSuccess: () => showToast(target.starredAt ? 'Removed from starred' : 'Starred') },
            );
          }}
          onDelete={() => {
            const target = actionTarget;
            setActionTarget(null);
            if (!target) return;
            Alert.alert(
              'Delete for me?',
              "This hides the message from VOXO. It can't be removed from the customer's WhatsApp — Meta's API has no way to recall a delivered message.",
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => deleteMessage.mutate(target.id) },
              ],
            );
          }}
          onSelectMore={() => {
            if (actionTarget) toggleSelected(actionTarget);
            setActionTarget(null);
          }}
          onForward={() => {
            if (actionTarget) setForwardTargets([actionTarget]);
            setActionTarget(null);
          }}
          onReply={() => {
            if (actionTarget) setReplyingTo(actionTarget);
            setActionTarget(null);
          }}
          onReact={(emoji) => {
            if (actionTarget) submitSend({ type: 'reaction', reactToMessageId: actionTarget.id, emoji });
            setActionTarget(null);
          }}
        />

        <AttachmentSheet
          visible={attachSheetOpen}
          whatsappPhoneNumberId={conversation?.whatsappPhoneNumberId}
          replyToMessageId={replyingTo?.id}
          onClose={() => setAttachSheetOpen(false)}
          onSent={() => setReplyingTo(null)}
          conversationId={conversationId}
        />

        <ImageViewerModal uri={viewerUri} onClose={() => setViewerUri(null)} />

        <ForwardSheet
          visible={forwardTargets.length > 0}
          messages={forwardTargets}
          currentConversationId={conversationId}
          onClose={() => setForwardTargets([])}
          onForwarded={(name, count) => {
            setForwardTargets([]);
            clearSelection();
            showToast(count > 1 ? `${count} messages forwarded to ${name}` : `Forwarded to ${name}`);
          }}
        />

        {toast ? (
          <View style={styles.toastWrap} pointerEvents="none">
            <View style={[styles.toast, { backgroundColor: chatColors.surfaceElevated, borderColor: chatColors.border }]}>
              <Text style={{ color: chatColors.textPrimary }}>{toast}</Text>
            </View>
          </View>
        ) : null}

        <TemplatePickerSheet
          visible={templateSheetOpen}
          onClose={() => setTemplateSheetOpen(false)}
          onPick={(template) => {
            submitSend({ type: 'template', templateName: template.name, languageCode: template.language });
            setTemplateSheetOpen(false);
          }}
        />
      </Screen>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  callErrorWrap: { paddingHorizontal: 16, paddingTop: 8 },
  // Real 48dp target for the header action — hitSlop was being clipped by
  // the navigator's own tight headerRight container.
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerAction: { width: touchTarget.min, height: touchTarget.min, alignItems: 'center', justifyContent: 'center' },
  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 96, alignItems: 'center' },
  toast: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  listContent: { paddingVertical: 8 },
});
