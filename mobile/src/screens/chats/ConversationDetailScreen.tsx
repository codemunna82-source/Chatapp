import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { Screen } from '../../components/Screen';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { InlineBanner } from '../../components/InlineBanner';
import { MessageBubble } from './MessageBubble';
import { DateSeparator } from './DateSeparator';
import { TypingIndicator } from './TypingIndicator';
import { Composer } from './Composer';
import { ReplyPreviewBar } from './ReplyPreviewBar';
import { MessageActionSheet } from './MessageActionSheet';
import { TemplatePickerSheet } from './TemplatePickerSheet';
import { AttachmentSheet } from './AttachmentSheet';
import { deriveConversationView } from './deriveConversationView';
import { useConversation } from '../../queries/useConversations';
import { useMessages, flattenMessages, useSendMessage, removeMessageFromCache } from '../../queries/useMessages';
import { useConversationRoom } from '../../sockets/useConversationRoom';
import { useSocketEvent } from '../../sockets/useSocketEvent';
import { emitConversationRead } from '../../sockets/actions';
import { usePlaceCall } from '../../queries/useCalls';
import { getApiErrorMessage } from '../../api/client';
import { useTheme } from '../../theme/ThemeProvider';
import { dayKey } from '../../utils/formatTime';
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

export function ConversationDetailScreen({ route, navigation }: Props) {
  const { conversationId } = route.params;
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  useConversationRoom(conversationId);

  const conversationQuery = useConversation(conversationId);
  const messagesQuery = useMessages(conversationId);
  const sendMessage = useSendMessage(conversationId);

  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [actionTarget, setActionTarget] = useState<Message | null>(null);
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const [templateSheetOpen, setTemplateSheetOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const typingClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { placeCall, isPending: callPending, apiError: callApiError, linkError: callLinkError } = usePlaceCall();
  const callError = callApiError ? getApiErrorMessage(callApiError, 'Could not start that call.') : callLinkError;
  const contactId = conversationQuery.data?.contactId;

  useEffect(() => {
    navigation.setOptions({
      title: conversationQuery.data?.contact?.name || conversationQuery.data?.contact?.phone || 'Conversation',
      headerRight: () =>
        contactId ? (
          <Pressable onPress={() => placeCall(contactId)} disabled={callPending} hitSlop={8} style={{ marginRight: 4 }}>
            <Ionicons name="call-outline" size={22} color={callPending ? colors.textSecondary : colors.primary} />
          </Pressable>
        ) : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- placeCall is a stable closure from usePlaceCall; including it would re-run this on every render
  }, [navigation, conversationQuery.data, contactId, callPending, colors.primary, colors.textSecondary]);

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

  const messages = flattenMessages(messagesQuery.data);
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

  const conversation = conversationQuery.data;

  if (messagesQuery.isLoading || conversationQuery.isLoading) {
    return <LoadingIndicator fullscreen />;
  }

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={[styles.flex, { backgroundColor: colors.background }]}>
          {callError ? (
            <View style={styles.callErrorWrap}>
              <InlineBanner message={callError} />
            </View>
          ) : null}
          <FlashList
            data={renderItems}
            inverted
            keyExtractor={(item: RenderItem) => item.id}
            renderItem={({ item }: { item: RenderItem }) =>
              item.kind === 'separator' ? (
                <DateSeparator iso={item.iso} />
              ) : (
                <MessageBubble
                  message={item.message}
                  replyTarget={item.message.replyToMessageId ? view.messageById.get(item.message.replyToMessageId) : undefined}
                  reactions={view.reactionsByTarget.get(item.message.id)}
                  onLongPress={() => setActionTarget(item.message)}
                  onRetry={() => handleRetry(item.message)}
                />
              )
            }
            onEndReached={() => {
              if (messagesQuery.hasNextPage && !messagesQuery.isFetchingNextPage) {
                messagesQuery.fetchNextPage();
              }
            }}
            onEndReachedThreshold={0.5}
            ListHeaderComponent={isTyping ? <TypingIndicator /> : null}
          />

          {replyingTo ? <ReplyPreviewBar target={replyingTo} onCancel={() => setReplyingTo(null)} /> : null}

          <Composer
            conversationId={conversationId}
            withinWindow={conversation?.withinCustomerServiceWindow ?? false}
            sending={sendMessage.isPending}
            onSendText={handleSendText}
            onAttach={() => setAttachSheetOpen(true)}
            onUseTemplate={() => setTemplateSheetOpen(true)}
          />
        </View>
      </KeyboardAvoidingView>

      <MessageActionSheet
        visible={Boolean(actionTarget)}
        canReact={Boolean(actionTarget && canReactTo(actionTarget))}
        onClose={() => setActionTarget(null)}
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

      <TemplatePickerSheet
        visible={templateSheetOpen}
        onClose={() => setTemplateSheetOpen(false)}
        onPick={(template) => {
          submitSend({ type: 'template', templateName: template.name, languageCode: template.language });
          setTemplateSheetOpen(false);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  callErrorWrap: { paddingHorizontal: 16, paddingTop: 8 },
});
