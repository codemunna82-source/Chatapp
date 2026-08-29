import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import * as messagesApi from '../api/endpoints/messages';
import type { SendMessageBody } from '../api/endpoints/messages';
import type { Message } from '../api/types';
import { queryKeys } from './keys';

type MessagesPage = { items: Message[]; nextCursor: string | null };
type MessagesData = InfiniteData<MessagesPage, string | undefined>;

export function useMessages(conversationId: string | undefined) {
  return useInfiniteQuery<MessagesPage, Error, MessagesData, ReturnType<typeof queryKeys.messages>, string | undefined>({
    queryKey: queryKeys.messages(conversationId ?? ''),
    queryFn: ({ pageParam }) => messagesApi.listMessages(conversationId as string, { cursor: pageParam }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(conversationId),
  });
}

/**
 * A filtered view of one conversation — in-chat search, or the starred
 * list. Kept as its OWN query rather than a parameter on useMessages so a
 * search never overwrites the main thread's cache: closing the search box
 * has to leave the full conversation exactly as it was, not refetch it
 * from page one.
 */
export function useFilteredMessages(
  conversationId: string | undefined,
  filter: { search?: string; starredOnly?: boolean },
) {
  const active = Boolean(conversationId) && Boolean(filter.search || filter.starredOnly);
  return useInfiniteQuery<
    MessagesPage,
    Error,
    MessagesData,
    ReturnType<typeof queryKeys.messagesFiltered>,
    string | undefined
  >({
    queryKey: queryKeys.messagesFiltered(conversationId ?? '', filter),
    queryFn: ({ pageParam }) =>
      messagesApi.listMessages(conversationId as string, { cursor: pageParam, ...filter }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: active,
  });
}

/** Star/unstar, writing the server's message straight back into every
 *  cached list that holds it. */
export function useStarMessage(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, starred }: { messageId: string; starred: boolean }) =>
      messagesApi.starMessage(conversationId, messageId, starred),
    onSuccess: (message) => {
      upsertMessageInCache(queryClient, conversationId, message);
      // The starred list is a separate query, so it has to be told too.
      void queryClient.invalidateQueries({ queryKey: queryKeys.messagesFilteredAll(conversationId) });
    },
  });
}

/** Newest-first flat list, matching the API's own ordering — the screen renders this directly into an inverted FlashList. */
export function flattenMessages(data: MessagesData | undefined): Message[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

function patchMessages(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  updater: (pages: MessagesPage[]) => MessagesPage[],
) {
  queryClient.setQueryData<MessagesData>(queryKeys.messages(conversationId), (old) => {
    if (!old) return old;
    return { ...old, pages: updater(old.pages) };
  });
}

/** Upserts one message by id anywhere in the cached pages, or prepends it to page 0 if new. */
function upsertMessage(pages: MessagesPage[], message: Message): MessagesPage[] {
  for (const page of pages) {
    const idx = page.items.findIndex((m) => m.id === message.id);
    if (idx !== -1) {
      const items = [...page.items];
      items[idx] = message;
      return pages.map((p) => (p === page ? { ...p, items } : p));
    }
  }
  if (pages.length === 0) return [{ items: [message], nextCursor: null }];
  const [first, ...rest] = pages;
  return [{ ...first!, items: [message, ...first!.items] }, ...rest];
}

/**
 * Inserts a local, not-yet-uploaded media message so it shows in the chat
 * immediately (WhatsApp-style) while the upload runs. The caller replaces or
 * removes it once the real send resolves.
 */
export function insertPendingMediaMessage(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  args: { tempId: string; type: Message['type']; localUri: string; text?: string; replyToMessageId?: string },
): void {
  upsertMessageInCache(queryClient, conversationId, {
    id: args.tempId,
    conversationId,
    direction: 'OUT',
    type: args.type,
    text: args.text,
    localUri: args.localUri,
    replyToMessageId: args.replyToMessageId,
    status: 'QUEUED',
    createdAt: new Date().toISOString(),
  });
}

export function upsertMessageInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  message: Message,
): void {
  patchMessages(queryClient, conversationId, (pages) => upsertMessage(pages, message));
}

export function patchMessageStatusInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  messageId: string,
  status: Message['status'],
): void {
  patchMessages(queryClient, conversationId, (pages) =>
    pages.map((page) => ({
      ...page,
      items: page.items.map((m) => (m.id === messageId ? { ...m, status } : m)),
    })),
  );
}

export function removeMessageFromCache(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  messageId: string,
): void {
  patchMessages(queryClient, conversationId, (pages) =>
    pages.map((page) => ({ ...page, items: page.items.filter((m) => m.id !== messageId) })),
  );
}

let tempIdCounter = 0;
function makeTempId(): string {
  tempIdCounter += 1;
  return `temp-${Date.now()}-${tempIdCounter}`;
}

/**
 * Optimistic send (spec §19): the message appears instantly with status
 * QUEUED, flips to whatever the server returns on success, and flips to
 * FAILED (not removed) on error so the composer/bubble can offer retry —
 * never silently drops a message the user believes they sent.
 */
/** "Delete for me" — drops the message from the cache once the server confirms. */
export function useDeleteMessage(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => messagesApi.deleteMessage(conversationId, messageId),
    onSuccess: (_result, messageId) => {
      removeMessageFromCache(queryClient, conversationId, messageId);
    },
  });
}

export function useSendMessage(conversationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SendMessageBody) => messagesApi.sendMessage(conversationId, body),
    onMutate: (body: SendMessageBody) => {
      const tempId = makeTempId();
      const optimistic: Message = {
        id: tempId,
        conversationId,
        direction: 'OUT',
        type: body.type,
        text: body.type === 'text' ? body.text : body.type === 'reaction' ? body.emoji : undefined,
        replyToMessageId:
          body.type === 'text' || body.type === 'image' || body.type === 'video' || body.type === 'audio' || body.type === 'document'
            ? body.replyToMessageId
            : body.type === 'reaction'
              ? body.reactToMessageId
              : undefined,
        status: 'QUEUED',
        createdAt: new Date().toISOString(),
      };
      upsertMessageInCache(queryClient, conversationId, optimistic);
      return { tempId };
    },
    onSuccess: (message, _body, context) => {
      patchMessages(queryClient, conversationId, (pages) =>
        pages.map((page) => ({
          ...page,
          items: page.items.filter((m) => m.id !== context.tempId),
        })),
      );
      upsertMessageInCache(queryClient, conversationId, message);
    },
    onError: (_err, _body, context) => {
      if (!context) return;
      patchMessages(queryClient, conversationId, (pages) =>
        pages.map((page) => ({
          ...page,
          items: page.items.map((m) => (m.id === context.tempId ? { ...m, status: 'FAILED' as const } : m)),
        })),
      );
    },
  });
}
