import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import Animated, {
  KeyboardState,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { Screen } from '../../components/Screen';
import { MessageListSkeleton } from '../../components/Skeleton';
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
import * as ImagePicker from 'expo-image-picker';
import { ChatHeaderTitle } from './ChatHeaderTitle';
import { AlbumBubble } from './AlbumBubble';
import { useUploadContactAvatar } from '../../queries/useContacts';
import { useGuestPresenceStore } from '../../store/guestPresenceStore';
import { MessageInfoSheet } from './MessageInfoSheet';
import { ScrollToBottomButton } from './ScrollToBottomButton';
import { AttachmentSheet } from './AttachmentSheet';
import { ForwardSheet, buildForwardBody } from './ForwardSheet';
import { ImageViewerModal } from './ImageViewerModal';
import { deriveConversationView } from './deriveConversationView';
import { useConversation } from '../../queries/useConversations';
import { useCallStore } from '../../calling/callStore';
import {
  useGuestLinkStatus,
  useIssueGuestLink,
  useRevokeGuestLink,
} from '../../queries/useGuestChat';
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
import {
  chatLightColors,
  chatDarkColors,
  chatHeaderBackground,
  chatHeaderForeground,
} from '../../theme/chatTheme';
import { dayKey } from '../../utils/formatTime';
import type { Edge } from 'react-native-safe-area-context';
import type { ChatsStackParamList } from '../../navigation/types';
import type { Message } from '../../api/types';
import type { SendMessageBody } from '../../api/endpoints/messages';

type Props = NativeStackScreenProps<ChatsStackParamList, 'ConversationDetail'>;

type RenderItem =
  | { kind: 'message'; id: string; message: Message }
  | { kind: 'album'; id: string; messages: Message[] }
  | { kind: 'separator'; id: string; iso: string };

/**
 * How far apart two photos can be and still be one album.
 *
 * Generous, because a batch of five uploads over mobile data does not
 * land in the same second — and a batch that half-grouped, into a grid
 * plus two loose bubbles, would look more broken than no grouping at all.
 */
const ALBUM_WINDOW_MS = 5 * 60_000;

/**
 * Whether a message can be a tile in a grid.
 *
 * A caption disqualifies it: the words belong to that one picture, and a
 * grid has nowhere to put them. Such a photo stays its own bubble, which
 * also ends any album being collected — otherwise the caption would end
 * up describing the tile above it.
 */
function isAlbumTile(m: Message): boolean {
  if (m.type !== 'image' && m.type !== 'video') return false;
  if (m.text) return false;
  if (m.replyToMessageId) return false;
  return Boolean(m.mediaId || m.localUri);
}

function sameAlbum(a: Message, b: Message): boolean {
  return (
    a.direction === b.direction &&
    Math.abs(Date.parse(b.createdAt) - Date.parse(a.createdAt)) <= ALBUM_WINDOW_MS
  );
}

function buildRenderItems(renderableNewestFirst: Message[]): RenderItem[] {
  const chronological = [...renderableNewestFirst].reverse();
  const items: RenderItem[] = [];
  let lastDay: string | null = null;

  /**
   * Photos waiting to be emitted, so a run can be judged only once it
   * ends. A run of one is emitted as an ordinary bubble — a "grid" of a
   * single photo would be a smaller photo for no reason.
   */
  let run: Message[] = [];
  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      const only = run[0]!;
      items.push({ kind: 'message', id: only.id, message: only });
    } else {
      // Keyed on the first tile's id: stable across re-renders, and it
      // changes when the run does, which is what tells FlashList the row
      // is a different thing rather than the same one rearranged.
      items.push({ kind: 'album', id: `album-${run[0]!.id}`, messages: run });
    }
    run = [];
  };

  for (const m of chronological) {
    const day = dayKey(m.createdAt);
    if (day !== lastDay) {
      // A day separator splits an album too: a grid spanning midnight
      // would sit on one side of a date it half belongs to.
      flush();
      items.push({ kind: 'separator', id: `sep-${day}`, iso: m.createdAt });
      lastDay = day;
    }

    if (isAlbumTile(m)) {
      const prev = run[run.length - 1];
      if (prev && !sameAlbum(prev, m)) flush();
      run.push(m);
      continue;
    }

    flush();
    items.push({ kind: 'message', id: m.id, message: m });
  }
  flush();

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
  // The photo the full-screen viewer is showing: the bubble's already
  // downloaded file, plus the media id so the viewer can upgrade it to
  // the original once it is open.
  const [viewer, setViewer] = useState<{ uri: string; mediaId?: string } | null>(null);
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
  // The header is chrome, not a band of brand colour: near-white in light,
  // raised charcoal in dark, with its icons and title drawn against it.
  // It used to be one fixed navy in both schemes, which made it the
  // loudest thing on the screen either way.
  const headerBg = chatHeaderBackground[scheme];
  const headerFg = chatHeaderForeground[scheme];
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
  //
  // `state` is read alongside `height`, and that is the fix for the dead
  // gap: leaving this screen with the keyboard up closes the IME, but the
  // shared height value is left holding its last measurement, so coming
  // back padded the composer up by a keyboard that is no longer there —
  // blank space where the keyboard used to be. The height is only honoured
  // while the keyboard is actually opening or open; in every other state
  // the pad falls back to the navigation bar inset.
  const keyboard = useAnimatedKeyboard();
  const insets = useSafeAreaInsets();

  /**
   * 1 once JS has seen the keyboard go away, 0 once it comes back.
   *
   * The state check above was not enough on its own. Dismissing the IME
   * with the Android back button does not always move useAnimatedKeyboard
   * out of OPEN — it is left holding both the state and the last height,
   * so the composer stayed padded up by a keyboard that was no longer on
   * screen, and the gap survived until the screen was left and reopened.
   * That is exactly the "press back and the space stays" report.
   *
   * keyboardDidHide is the reliable half of RN's JS keyboard events under
   * edge-to-edge — the heights it reports are not trustworthy there, but
   * "it went away" is — so it is used for that one bit and nothing else.
   */
  const keyboardGone = useSharedValue(1);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => {
      keyboardGone.value = 0;
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      keyboardGone.value = 1;
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [keyboardGone]);

  const keyboardPadStyle = useAnimatedStyle(() => {
    const up =
      keyboardGone.value === 0 &&
      (keyboard.state.value === KeyboardState.OPEN ||
        keyboard.state.value === KeyboardState.OPENING);
    return { paddingBottom: up ? Math.max(keyboard.height.value, insets.bottom) : insets.bottom };
  });



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

  /**
   * Only the CROSSING matters, not every frame of the scroll.
   *
   * This ran setState on every scroll event and did its transition work
   * inside the updater. React bails out on an unchanged value, so it was
   * cheap enough at four callbacks a second — but the throttle is 16ms
   * now, so it fires sixty times a second, and a side effect living in a
   * state updater is the wrong place for it either way (it can run twice
   * under StrictMode). The ref makes the common frame do one comparison
   * and nothing else.
   */
  const scrolledUpRef = useRef(false);
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const away = e.nativeEvent.contentOffset.y > SCROLLED_UP_THRESHOLD;
      if (away === scrolledUpRef.current) return;
      scrolledUpRef.current = away;
      setScrolledUp(away);
      setAnchorMessageId(away ? (messages[0]?.id ?? null) : null);
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

  const guestLinkQuery = useGuestLinkStatus(conversationId);
  const uploadContactAvatar = useUploadContactAvatar();
  const issueGuestLink = useIssueGuestLink(conversationId);
  const revokeGuestLink = useRevokeGuestLink(conversationId);

  const guestActive = guestLinkQuery.data?.active ?? false;
  /**
   * Whether the customer is sitting in the web window right now.
   *
   * Live socket presence, not the link's existence: `guestActive` says a
   * link was issued, which stays true for a month whether or not anyone
   * ever tapped it.
   */
  const guestOnline = useGuestPresenceStore((s) => Boolean(s.open[conversationId]));
  const withinWhatsAppWindow =
    (conversationQuery.data?.isDemo ?? false) ||
    (conversationQuery.data?.withinCustomerServiceWindow ?? false);
  const shareGuestLink = useCallback(
    async (url: string) => {
      const name = conversationQuery.data?.contact?.name || 'there';
      await Share.share({
        message: `Hi ${name}, continue our conversation privately here: ${url}`,
      });
    },
    [conversationQuery.data],
  );

  /**
   * A live web window means a call that actually connects inside the app.
   * The WhatsApp path cannot do that — outbound WhatsApp calling is a
   * hand-off to wa.me, which leaves VOXO entirely — so when both are
   * possible the web one is plainly better for the agent.
   */
  const handleCall = useCallback(() => {
    if (guestActive) {
      const name = conversationQuery.data?.contact?.name || conversationQuery.data?.contact?.phone || 'Customer';
      void useCallStore.getState().placeWebCall(conversationId, name);
      return;
    }
    if (contactId) placeCall(contactId);
  }, [guestActive, conversationId, contactId, placeCall, conversationQuery.data]);

  /**
   * Setting the customer's photo from the chat itself.
   *
   * The upload endpoint and the picker both already existed — the only
   * way to reach them was the contact form inside Manage contacts, a
   * screen most people never open, so a DP could be set but effectively
   * never was. The chat header is where anyone looks for a photo, so it
   * is where setting one belongs.
   */
  const pickContactPhoto = useCallback(async () => {
    if (!contactId || uploadContactAvatar.isPending) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // Square, because that is how it is rendered everywhere it appears.
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;

    uploadContactAvatar.mutate(
      {
        id: contactId,
        file: {
          uri: asset.uri,
          // The picker can return a uri with no filename at all; multipart
          // still requires one, and the mime type does the real work.
          name: asset.fileName ?? 'avatar.jpg',
          mimeType: asset.mimeType ?? 'image/jpeg',
        },
      },
      { onError: (err) => Alert.alert('Could not update the photo', getApiErrorMessage(err)) },
    );
  }, [contactId, uploadContactAvatar]);

  const handleGuestLink = useCallback(() => {
    if (issueGuestLink.isPending || revokeGuestLink.isPending) return;

    const create = () => {
      issueGuestLink.mutate(undefined, {
        onSuccess: (link) => {
          void shareGuestLink(link.url);
        },
        onError: (err) => Alert.alert('Could not create link', getApiErrorMessage(err)),
      });
    };

    if (!guestActive) {
      create();
      return;
    }

    // The URL of a live link cannot be shown again — only its hash is
    // stored — so the honest offer is to replace it, which is also what
    // makes every copy already sent stop working.
    Alert.alert(
      'A link is already active',
      'The existing link cannot be shown again. Creating a new one will stop the old link working.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'New link',
          style: 'destructive',
          onPress: () =>
            revokeGuestLink.mutate(undefined, {
              onSuccess: create,
              onError: (err) => Alert.alert('Could not replace link', getApiErrorMessage(err)),
            }),
        },
      ],
    );
  }, [guestActive, issueGuestLink, revokeGuestLink, shareGuestLink]);

  const handleSendText = useCallback(
    (text: string) => {
      // One path for both channels. The server decides which one this
      // leaves on, so the composer no longer has to — and cannot get it
      // wrong, which it did: choosing WhatsApp while the window was open
      // delivered the message to the customer twice.
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
        headerStyle: { backgroundColor: headerBg },
        headerTintColor: headerFg,
        headerTitleStyle: { color: headerFg },
        headerRight: () => null,
        headerLeft: () => (
          <Pressable
            onPress={closeSearch}
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityLabel="Close search"
          >
            {({ pressed }) => <Ionicons name="close" size={24} color={headerFg} style={{ opacity: pressed ? 0.5 : 1 }} />}
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
        headerStyle: { backgroundColor: headerBg },
        headerTintColor: headerFg,
        headerTitleStyle: { color: headerFg },
        headerLeft: () => (
          <Pressable
            onPress={clearSelection}
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityLabel="Cancel selection"
          >
            {({ pressed }) => <Ionicons name="close" size={24} color={headerFg} style={{ opacity: pressed ? 0.5 : 1 }} />}
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
              <Ionicons name="arrow-redo" size={22} color={headerFg} style={{ opacity: pressed ? 0.5 : 1 }} />
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
          foreground={headerFg}
          name={contactLabel}
          contactId={contactId}
          avatarUpdatedAt={conversationQuery.data?.contact?.avatarUpdatedAt}
          onPressAvatar={pickContactPhoto}
          windowExpiresAt={conversationQuery.data?.conversationWindowExpiresAt}
          withinWindow={conversationQuery.data?.withinCustomerServiceWindow ?? true}
          isDemo={conversationQuery.data?.isDemo ?? false}
          guestOnline={guestOnline}
          guestActive={guestActive}
        />
      ),
      // The header itself stays a fixed navy in both schemes (matches both
      // reference images identically) — hardcoded rather than theme-driven
      // since headerStyle/headerTintColor render through React Navigation's
      // own header, outside the nested <ThemeProvider colors={chatColors}>
      // wrap below (that only covers this component's own returned JSX).
      headerStyle: { backgroundColor: headerBg },
      headerTintColor: headerFg,
      headerTitleStyle: { color: headerFg },
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => setSearchOpen(true)}
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityLabel="Search in this chat"
          >
            {({ pressed }) => (
              <Ionicons name="search" size={21} color={headerFg} style={{ opacity: pressed ? 0.5 : 1 }} />
            )}
          </Pressable>
          <Pressable
            onPress={handleGuestLink}
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityLabel={guestActive ? 'Replace private chat link' : 'Send a private chat link'}
          >
            {({ pressed }) => (
              <Ionicons
                // Filled once a window is live, so the state is readable
                // without opening anything.
                name={guestActive ? 'link' : 'link-outline'}
                size={21}
                color={headerFg}
                style={{ opacity: pressed ? 0.5 : 1 }}
              />
            )}
          </Pressable>
          {/* Only while the customer is actually in the private window.
              The button used to show whenever the chat had a contact, so
              it offered a call to someone with nothing to ring: the web
              call needs the customer's page open to answer on, and a live
              LINK is not the same as a live window — a link sits in a
              WhatsApp thread for a month whether or not anyone opened it.
              An icon that places a call nobody can pick up is worse than
              an icon that appears when the call will connect. */}
          {contactId && guestOnline ? (
          <Pressable
            onPress={handleCall}
            disabled={callPending}
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityState={{ disabled: callPending }}
            accessibilityLabel="Call this customer in the private chat"
          >
            {({ pressed }) => (
              <Ionicons
                name="call"
                size={22}
                color={callPending ? `${headerFg}80` : headerFg}
                style={{ opacity: pressed ? 0.5 : 1 }}
              />
            )}
          </Pressable>
          ) : null}
        </View>
      ),
    });
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
    guestActive,
    // Without this the header keeps whatever presence it was built with:
    // setOptions only re-runs when this array changes, so the customer
    // could arrive and the subtitle would never say so.
    guestOnline,
    handleGuestLink,
    handleCall,
    // Without this the header keeps the first callback it was built with,
    // which closes over a stale contactId — so tapping the photo on a
    // chat opened second would upload to the first one's contact.
    pickContactPhoto,
    // The header is rebuilt when the scheme flips, or switching to dark
    // would leave a white-on-white title until the screen was reopened.
    headerBg,
    headerFg,
  ]);
  const handleOpenImage = useCallback((localUri: string, mediaId?: string) => setViewer({ uri: localUri, mediaId }), []);

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
      ) : item.kind === 'album' ? (
        <AlbumBubble
          messages={item.messages}
          onOpenImage={selectionMode ? undefined : handleOpenImage}
          onLongPress={handleLongPress}
        />
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
    // Bubble-shaped placeholders over the real wallpaper, so the screen the
    // user is arriving at is already recognisably this chat.
    return (
      <ThemeProvider colors={chatColors}>
        <Screen padded={false} edges={SCREEN_EDGES}>
          <View style={styles.flex}>
            <ChatWallpaper />
            <MessageListSkeleton />
          </View>
        </Screen>
      </ThemeProvider>
    );
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
            {/* No banner for this. It sat across the top of every
                conversation with an open private window — which is now the
                normal state, not an exceptional one — and a coloured strip
                that never goes away stops being read within a day.
                The header subtitle already says "Private chat open · reply
                anytime", in the one place someone looks to see who they
                are talking to. */}
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
              // 16ms rather than 64: the scroll handler drives the
              // scrolled-up state and the jump-to-bottom button, and at 64
              // that button appeared a visible beat after the thumb moved.
              // It is a cheap handler — two comparisons — so the extra
              // callbacks cost far less than the lag they remove.
              scrollEventThrottle={16}
              // Rows kept rendered beyond the viewport. The default is
              // conservative, so flicking a thread showed blank cells that
              // filled in a frame later; a screen's worth of runway ahead
              // is what makes a fast scroll look continuous.
              drawDistance={600}
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
              // A demo chat always has an open composer: the backend skips
              // the window rule for it too, so this is not the client
              // deciding to ignore a server constraint.
              // A live web window is a real way to reach the customer, so
              // the composer stays open on it — handleSendText routes the
              // message down whichever channel is actually available.
              withinWindow={withinWhatsAppWindow || guestActive}
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
          onUploadFailed={(message) => Alert.alert('Message not sent', message)}
          conversationId={conversationId}
        />

        <ImageViewerModal uri={viewer?.uri ?? null} mediaId={viewer?.mediaId} onClose={() => setViewer(null)} />

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
