import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { Screen } from '../../components/Screen';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { InlineBanner } from '../../components/InlineBanner';
import { MessageBubble } from './MessageBubble';
import { ChatWallpaper } from './ChatWallpaper';
import { DateSeparator } from './DateSeparator';
import { TypingIndicator } from './TypingIndicator';
import { Composer } from './Composer';
import { ReplyPreviewBar } from './ReplyPreviewBar';
import { MessageActionSheet } from './MessageActionSheet';
import { TemplatePickerSheet } from './TemplatePickerSheet';
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
  removeMessageFromCache,
} from '../../queries/useMessages';
import { useConversationRoom } from '../../sockets/useConversationRoom';
import { useSocketEvent } from '../../sockets/useSocketEvent';
import { emitConversationRead } from '../../sockets/actions';
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
// Lets FlashList recycle separators and bubbles into separate pools instead
// of reusing one cell type for both.
const getItemType = (item: RenderItem) => item.kind;

export function ConversationDetailScreen({ route, navigation }: Props) {
  const { conversationId } = route.params;
  const queryClient = useQueryClient();

  useConversationRoom(conversationId);

  const conversationQuery = useConversation(conversationId);
  const messagesQuery = useMessages(conversationId);
  const sendMessage = useSendMessage(conversationId);
  const deleteMessage = useDeleteMessage(conversationId);

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


  useEffect(() => {
    emitConversationRead(conversationId);
  }, [conversationId]);

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
  const view = useMemo(() => deriveConversationView(messages), [messages]);
  const renderItems = useMemo(() => buildRenderItems(view.renderable), [view.renderable]);

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
    if (selectionMode) {
      // Selection bar replaces the normal header: count on the left, a
      // close and a forward action on the right.
      navigation.setOptions({
        title: `${selectedIds.length} selected`,
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

    navigation.setOptions({
      headerLeft: undefined,
      title: conversationQuery.data?.contact?.name || conversationQuery.data?.contact?.phone || 'Conversation',
      // The header itself stays a fixed navy in both schemes (matches both
      // reference images identically) — hardcoded rather than theme-driven
      // since headerStyle/headerTintColor render through React Navigation's
      // own header, outside the nested <ThemeProvider colors={chatColors}>
      // wrap below (that only covers this component's own returned JSX).
      headerStyle: { backgroundColor: chatHeaderBackground },
      headerTintColor: '#FFFFFF',
      headerTitleStyle: { color: '#FFFFFF' },
      headerRight: () =>
        contactId ? (
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
        ) : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- placeCall is a stable closure from usePlaceCall; including it would re-run this on every render
  }, [navigation, conversationQuery.data, contactId, callPending, selectionMode, selectedIds.length, clearSelection, forwardSelected]);
  const handleOpenImage = useCallback((localUri: string) => setViewerUri(localUri), []);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

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
            {callError ? (
              <View style={styles.callErrorWrap}>
                <InlineBanner message={callError} />
              </View>
            ) : null}
            <FlashList
              data={renderItems}
              inverted
              keyExtractor={keyExtractor}
              getItemType={getItemType}
              renderItem={renderItem}
              onEndReached={handleEndReached}
              onEndReachedThreshold={0.5}
              ListHeaderComponent={isTyping ? <TypingIndicator /> : null}
              contentContainerStyle={styles.listContent}
            />

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

        <MessageActionSheet
          visible={Boolean(actionTarget)}
          canReact={Boolean(actionTarget && canReactTo(actionTarget))}
          canCopy={Boolean(actionTarget?.text)}
          canForward={Boolean(actionTarget && buildForwardBody(actionTarget))}
          onClose={() => setActionTarget(null)}
          onCopy={handleCopy}
          canSelect={Boolean(actionTarget && buildForwardBody(actionTarget))}
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
  headerAction: { width: touchTarget.min, height: touchTarget.min, alignItems: 'center', justifyContent: 'center' },
  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 96, alignItems: 'center' },
  toast: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  listContent: { paddingVertical: 8 },
});
