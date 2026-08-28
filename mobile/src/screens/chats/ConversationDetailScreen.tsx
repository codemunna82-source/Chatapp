import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { deriveConversationView } from './deriveConversationView';
import { useConversation } from '../../queries/useConversations';
import { useMessages, flattenMessages, useSendMessage, removeMessageFromCache } from '../../queries/useMessages';
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

  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [actionTarget, setActionTarget] = useState<Message | null>(null);
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const [templateSheetOpen, setTemplateSheetOpen] = useState(false);
  const [forwardTarget, setForwardTarget] = useState<Message | null>(null);
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

  useEffect(() => {
    navigation.setOptions({
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
  }, [navigation, conversationQuery.data, contactId, callPending]);

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
  const handleLongPress = useCallback((message: Message) => setActionTarget(message), []);
  const handleReply = useCallback((message: Message) => setReplyingTo(message), []);

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
          onReply={handleReply}
        />
      ),
    [view, handleLongPress, handleRetry, handleReply],
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
      {/* edges={['top']}: the composer applies the bottom inset itself so it
          can drop it while the keyboard is up — see useKeyboardVisible. */}
      <Screen padded={false} edges={SCREEN_EDGES}>
        <KeyboardAvoidingView
          style={styles.flex}
          // 'padding' on Android too, deliberately: this app runs
          // edge-to-edge (targetSdk 36), where Android ignores
          // windowSoftInputMode="adjustResize" and delivers the keyboard as
          // a window inset instead. Leaving behavior undefined here — the
          // old value — meant no avoidance at all on Android, which is why
          // the keyboard covered the composer. The view sits below the
          // navigator's header, so no vertical offset is needed.
          behavior="padding"
        >
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
        </KeyboardAvoidingView>

        <MessageActionSheet
          visible={Boolean(actionTarget)}
          canReact={Boolean(actionTarget && canReactTo(actionTarget))}
          canCopy={Boolean(actionTarget?.text)}
          canForward={Boolean(actionTarget && buildForwardBody(actionTarget))}
          onClose={() => setActionTarget(null)}
          onCopy={handleCopy}
          onForward={() => {
            setForwardTarget(actionTarget);
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

        <ForwardSheet
          visible={Boolean(forwardTarget)}
          message={forwardTarget}
          currentConversationId={conversationId}
          onClose={() => setForwardTarget(null)}
          onForwarded={(name) => {
            setForwardTarget(null);
            showToast(`Forwarded to ${name}`);
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
