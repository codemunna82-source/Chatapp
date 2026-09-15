import { useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import * as messagesApi from '../api/endpoints/messages';
import type { SendMessageBody } from '../api/endpoints/messages';
import type { Message } from '../api/types';
import { queryKeys } from './keys';
import { perfStart, perfMark, perfEnd } from '../utils/perfTrace';
import { playSentSound } from '../sockets/useMessageAlert';
import { isOfflineError } from '../api/client';
import { useOutboxStore, isQueueableBody } from '../store/outboxStore';
import { captureHandledError } from '../lib/sentry';
import { readCachedMessages, writeCachedMessages } from '../storage/chatCache';

type MessagesPage = { items: Message[]; nextCursor: string | null };
type MessagesData = InfiniteData<MessagesPage, string | undefined>;

/**
 * The thread as it was left on disk, shaped into the one page React Query
 * can start from.
 *
 * Read once per mount, not per render: MMKV is synchronous, so a read on
 * every render would be a JSON.parse of fifty messages in the render pass
 * of a list that is trying to be smooth.
 */
function useCachedFirstPage(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string | undefined,
): MessagesData | undefined {
  return useMemo(() => {
    if (!conversationId) return undefined;
    // Already in memory: React Query would discard initialData, so the
    // read and the parse would be pure cost on the very frame that opens
    // the chat — which is the frame this whole cache exists to protect.
    if (queryClient.getQueryData(queryKeys.messages(conversationId))) return undefined;
    const cached = readCachedMessages(conversationId);
    if (!cached || cached.items.length === 0) return undefined;
    return {
      pages: [{ items: cached.items, nextCursor: cached.nextCursor }],
      pageParams: [undefined],
    };
  }, [queryClient, conversationId]);
}

export function useMessages(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  const cached = useCachedFirstPage(queryClient, conversationId);

  const query = useInfiniteQuery<MessagesPage, Error, MessagesData, ReturnType<typeof queryKeys.messages>, string | undefined>({
    queryKey: queryKeys.messages(conversationId ?? ''),
    queryFn: ({ pageParam }) => messagesApi.listMessages(conversationId as string, { cursor: pageParam }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(conversationId),
    /**
     * A thread is kept fresh by the socket, not by refetching it.
     *
     * Every new message, status change and read receipt is pushed and
     * merged straight into this cache (see RealtimeSync), and a dropped
     * socket invalidates messagesAll on reconnect — so the 30s default
     * was spending a request on data that was already correct every time
     * a chat was reopened or the app came back to the foreground.
     */
    staleTime: 5 * 60_000,
    /**
     * Reopening a recent chat should be instant.
     *
     * The 5-minute default meant a conversation you left ten minutes ago
     * came back as a full-screen skeleton and a round trip, even though
     * nothing in it had changed. Half an hour covers the way people
     * actually use an inbox — in and out of the same few threads — at the
     * cost of some text held in memory.
     */
    gcTime: 30 * 60_000,
    /**
     * Open the chat, see the chat (spec §3).
     *
     * The last page of this conversation is on disk, so the screen is
     * painted with real messages in its first render pass instead of a
     * skeleton and a round trip. This only ever applies on a COLD start:
     * once the query exists in memory React Query ignores initialData
     * entirely, so moving in and out of a thread within a session still
     * takes the in-memory cache and the staleTime above.
     */
    initialData: cached,
    /**
     * Stale the moment it is restored, deliberately.
     *
     * Dating it by when it was written would let a cache under five
     * minutes old skip the refetch — and on a cold start that refetch is
     * the only thing that closes the gap, since the socket replays
     * nothing and RealtimeSync's resync deliberately skips the first
     * connect. So the disk copy is what gets DRAWN, and the network is
     * still what it gets CORRECTED by, every launch.
     */
    initialDataUpdatedAt: cached ? 0 : undefined,
  });

  usePersistMessages(conversationId, query.data);

  return query;
}

/**
 * Writes the thread back to disk as it changes.
 *
 * Debounced, because this data moves for reasons that are not worth a
 * write each: a delivery receipt, a read receipt and an upload's progress
 * all land as separate patches, and serialising fifty messages on every
 * one of them would spend the frame budget this cache exists to save. The
 * pending write is flushed on unmount so leaving a chat always leaves the
 * newest copy behind.
 */
const PERSIST_DEBOUNCE_MS = 800;

function usePersistMessages(conversationId: string | undefined, data: MessagesData | undefined): void {
  const latest = useRef<MessagesData | undefined>(undefined);

  useEffect(() => {
    latest.current = data;
  }, [data]);

  useEffect(() => {
    if (!conversationId || !data) return;
    const timer = setTimeout(() => persist(conversationId, latest.current), PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [conversationId, data]);

  useEffect(() => {
    if (!conversationId) return;
    return () => persist(conversationId, latest.current);
  }, [conversationId]);
}

function persist(conversationId: string, data: MessagesData | undefined): void {
  if (!data || data.pages.length === 0) return;
  writeCachedMessages(
    conversationId,
    flattenMessages(data),
    data.pages[data.pages.length - 1]?.nextCursor ?? null,
  );
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

/**
 * Moves a pending attachment's progress bar.
 *
 * Its own helper rather than a full upsert: this fires many times a
 * second during an upload, and rebuilding the whole message would make
 * every other field race with whatever else is writing to this row.
 * Missing rows are ignored — an upload whose bubble was already removed
 * (cancelled, or failed and cleaned up) has nothing to paint.
 */
export function patchUploadProgressInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  tempId: string,
  progress: number,
): void {
  patchMessages(queryClient, conversationId, (pages) =>
    pages.map((page) => ({
      ...page,
      items: page.items.map((m) => (m.id === tempId ? { ...m, uploadProgress: progress } : m)),
    })),
  );
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

/**
 * Turns a message in the cache into the tombstone both sides now see.
 *
 * Replaces rather than removes, unlike removeMessageFromCache above: a
 * withdrawn message leaves a visible trace on the customer's screen, and
 * a thread that silently loses a row here would disagree with the one
 * they are looking at.
 *
 * The content fields are cleared explicitly even though the server has
 * already deleted them, because the row in this cache is the one that
 * was fetched before the revoke and still holds all of it.
 */
export function revokeMessageInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string,
  messageId: string,
  revokedBy: 'agent' | 'customer',
  revokedAt = new Date().toISOString(),
): void {
  patchMessages(queryClient, conversationId, (pages) =>
    pages.map((page) => ({
      ...page,
      items: page.items.map((m) =>
        m.id === messageId
          ? {
              ...m,
              revokedAt,
              revokedBy,
              text: undefined,
              mediaId: undefined,
              localUri: undefined,
              location: undefined,
              starredAt: undefined,
              uploadProgress: undefined,
            }
          : m,
      ),
    })),
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
/**
 * Deleting a message, for this workspace or for both sides.
 *
 * 'me' drops it from the cache; 'everyone' leaves a tombstone, matching
 * what the customer is now looking at. Applied only once the server has
 * confirmed — the 'everyone' request is the one that can legitimately be
 * refused (wrong channel, too late, not ours), and an optimistic
 * tombstone would have to be un-drawn in front of the agent.
 */
export function useDeleteMessage(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, scope }: { messageId: string; scope: 'me' | 'everyone' }) =>
      messagesApi.deleteMessage(conversationId, messageId, scope),
    onSuccess: (_result, { messageId, scope }) => {
      if (scope === 'everyone') {
        revokeMessageInCache(queryClient, conversationId, messageId, 'agent');
      } else {
        removeMessageFromCache(queryClient, conversationId, messageId);
      }
    },
  });
}

export function useSendMessage(conversationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SendMessageBody) => messagesApi.sendMessage(conversationId, body),
    onMutate: (body: SendMessageBody) => {
      const tempId = makeTempId();

      /**
       * The optimistic bubble's id is also this send's id on the wire.
       *
       * Stamped onto the body object itself, which React Query hands to
       * mutationFn and to onError unchanged — so the outbox stores a body
       * that already carries it, and every retry of that body presents
       * the SAME id. The server returns the message it already has rather
       * than creating a second one, which is what stops a send whose
       * response was lost from reaching the customer twice.
       *
       * Assigning to the caller's object rather than copying is
       * deliberate: a copy would leave the outbox holding the original,
       * un-stamped body, and the retry — the one case this exists for —
       * would be the one without protection.
       */
      body.clientMessageId = tempId;

      // SEND_CLICK. The id doubles as the trace key because it is already
      // the one thing that follows this message all the way through: the
      // optimistic bubble, the wire, the server's dedupe, and back.
      perfStart(tempId, 'send');

      const optimistic: Message = {
        id: tempId,
        conversationId,
        direction: 'OUT',
        type: body.type,
        text: body.type === 'text' ? body.text : body.type === 'reaction' ? body.emoji : undefined,
        // Carried, so the pin draws in the optimistic bubble too. Without
        // it the row is a location with no coordinates for the length of
        // the round trip, which both clients render as the sentence they
        // fall back to — the map would appear a moment after the bubble.
        location: body.type === 'location' ? body.location : undefined,
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
      // UI_RENDERED for the SENDER. The bubble is on screen from here —
      // which is the point of the optimistic write, and the reason the
      // sender's own experience was never the thing that felt slow.
      perfMark(tempId, 'optimistic_render');
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
      // SERVER_ACK. One clock, both ends: this is the full round trip —
      // network out, everything the server did, network back. Compare it
      // against the server's own `perf message.send` total to split the
      // network from the backend without trusting two clocks to agree.
      perfMark(context.tempId, 'server_ack');
      perfEnd(context.tempId, 'send');
      // On success only. A sound for a send that then fails would be a
      // false confirmation — the FAILED bubble is the honest signal there.
      playSentSound();
    },
    onError: (err, body, context) => {
      if (!context) return;

      // A send that never reached the server is not a failure the user
      // needs to act on — it is a message waiting for signal. Queue it and
      // leave the bubble QUEUED; OutboxFlusher sends it when the
      // connection comes back, even across an app restart.
      //
      // Anything the server actually answered (a closed 24-hour window, a
      // rejected template) would fail identically on every retry, so it
      // goes straight to FAILED with its retry affordance instead.
      if (isOfflineError(err) && isQueueableBody(body)) {
        useOutboxStore.getState().enqueue({
          id: context.tempId,
          conversationId,
          body,
          queuedAt: new Date().toISOString(),
        });
        return;
      }

      // Reported, not just rendered. A send that the server rejected is
      // the single failure a user of this app cares most about, and the
      // FAILED bubble only ever tells the one person looking at it — the
      // error itself would otherwise never leave the device. The body is
      // deliberately not attached: it holds the message text.
      captureHandledError(err, { stage: 'sendMessage', messageType: body.type });

      patchMessages(queryClient, conversationId, (pages) =>
        pages.map((page) => ({
          ...page,
          items: page.items.map((m) => (m.id === context.tempId ? { ...m, status: 'FAILED' as const } : m)),
        })),
      );
    },
  });
}
