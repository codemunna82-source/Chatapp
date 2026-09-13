import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import * as conversationsApi from '../api/endpoints/conversations';
import type { ListConversationsParams } from '../api/endpoints/conversations';
import type { Conversation, ConversationStatus } from '../api/types';
import { queryKeys } from './keys';
import { dropCachedMessages, readCachedConversations, writeCachedConversations } from '../storage/chatCache';

type ConversationsPage = { items: Conversation[]; nextCursor: string | null };
type ConversationsData = InfiniteData<ConversationsPage, string | undefined>;

/**
 * Whether this particular view is the one kept on disk.
 *
 * Exactly one list is cached — the open chats, unfiltered, at the default
 * page size — because that is the screen a cold start lands on. A
 * search's results are not the list, an archived view is not the list,
 * and seeding either from the other would put rows on screen that do not
 * belong to the query that asked for them. The page size is part of it
 * for the same reason: one store, so one shape may claim it.
 */
function isCacheableList(params: Omit<ListConversationsParams, 'cursor'>): boolean {
  return !params.search && !params.pinnedOnly && params.limit === undefined && params.status === 'OPEN';
}

export function useConversations(params: Omit<ListConversationsParams, 'cursor'> = {}) {
  const queryClient = useQueryClient();
  const cacheable = isCacheableList(params);
  const key = queryKeys.conversations(params);
  const cached = useMemo<ConversationsData | undefined>(() => {
    if (!cacheable) return undefined;
    // In memory already — initialData would be thrown away, so reading
    // and parsing the list off disk would buy nothing.
    if (queryClient.getQueryData(key)) return undefined;
    const stored = readCachedConversations();
    if (!stored || stored.items.length === 0) return undefined;
    return { pages: [{ items: stored.items, nextCursor: stored.nextCursor }], pageParams: [undefined] };
    // `key` is a fresh array every render, so it cannot be a dependency.
    // It does not need to be: only one params shape is ever cacheable
    // (see isCacheableList), so `cacheable` being true pins the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, cacheable]);

  const query = useInfiniteQuery({
    queryKey: queryKeys.conversations(params),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      conversationsApi.listConversations({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // The search text is part of the query key, so every debounced change
    // starts a query with an empty cache — which threw the list back to a
    // full-screen skeleton on each one. Holding the previous page keeps
    // the results on screen, greyed by isFetching, while the next set
    // loads: the same data arrives at the same time, but the screen stops
    // flashing between them.
    placeholderData: keepPreviousData,
    /**
     * The inbox is on screen before the first request finishes.
     *
     * Same contract as useMessages: the disk copy is what gets drawn on a
     * cold start, and the refetch that initialDataUpdatedAt: 0 forces is
     * what corrects it. Only the default view is seeded — see
     * isCacheableList.
     */
    initialData: cached,
    initialDataUpdatedAt: cached ? 0 : undefined,
  });

  usePersistConversations(cacheable, query.data as ConversationsData | undefined);

  return query;
}

const PERSIST_DEBOUNCE_MS = 800;

/**
 * Keeps the cached inbox in step with the list on screen.
 *
 * Only the first page is stored — see writeCachedConversations for why
 * the whole scroll cannot be.
 */
function usePersistConversations(cacheable: boolean, data: ConversationsData | undefined): void {
  const latest = useRef<ConversationsData | undefined>(undefined);

  useEffect(() => {
    latest.current = data;
  }, [data]);

  useEffect(() => {
    if (!cacheable || !data) return;
    const timer = setTimeout(() => {
      const first = latest.current?.pages[0];
      if (first) writeCachedConversations(first.items, first.nextCursor);
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [cacheable, data]);
}

/** Flattens the infinite-query pages into one list for FlashList. */
export function flattenConversations(data: ReturnType<typeof useConversations>['data']): Conversation[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

export function useConversation(id: string | undefined) {
  /**
   * The header comes off the cached list, so the chat screen is not held
   * behind a skeleton waiting for a name it already knows.
   *
   * Safe to mix the two sources: the list endpoint and the single-
   * conversation endpoint run the SAME serializer server-side
   * (toPublicConversation), so a row taken from the list is the identical
   * object the detail request is about to return — and it is replaced by
   * that response a moment later regardless.
   */
  const queryClient = useQueryClient();
  const cached = useMemo(() => {
    if (!id) return undefined;
    if (queryClient.getQueryData(queryKeys.conversation(id))) return undefined;
    return readCachedConversations()?.items.find((c) => c.id === id);
  }, [queryClient, id]);

  return useQuery({
    queryKey: queryKeys.conversation(id ?? ''),
    queryFn: () => conversationsApi.getConversation(id as string),
    enabled: Boolean(id),
    initialData: cached,
    initialDataUpdatedAt: cached ? 0 : undefined,
  });
}

/**
 * Starts (or reopens) the chat with a contact. Idempotent server-side, so
 * picking the same contact twice lands on the same thread.
 */
export function useStartConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) => conversationsApi.startConversation(contactId),
    onSuccess: (conversation) => {
      queryClient.setQueryData(queryKeys.conversation(conversation.id), conversation);
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => conversationsApi.deleteConversation(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.conversation(id) });
      queryClient.removeQueries({ queryKey: queryKeys.messages(id) });
      dropCachedMessages([id]);
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
    },
  });
}


/**
 * Applies a change to a conversation everywhere it is cached, right now.
 *
 * Pin, archive and mark-unread used to wait for the server and then
 * invalidate the whole list — two round trips before anything moved on
 * screen, which on this deployment is most of a second of a button that
 * looks broken. They are all small, reversible, single-field changes on a
 * row the user is looking at, which is exactly the shape an optimistic
 * update is for.
 *
 * Returns a snapshot so the caller can put it back if the server refuses.
 * Rolling back by refetching would be simpler and wrong: it would leave
 * the failed state on screen for the length of the refetch.
 */
type ConversationsSnapshot = [readonly unknown[], unknown][];

function patchConversationEverywhere(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
  patch: Partial<Conversation>,
): ConversationsSnapshot {
  // Every list query, whatever its filters — the same chat appears in the
  // all/pinned/archived views at once, and patching only the visible one
  // leaves the others to contradict it on the next tab switch.
  const snapshot: ConversationsSnapshot = queryClient.getQueriesData({
    queryKey: queryKeys.conversationsAll,
  });

  queryClient.setQueriesData<InfiniteData<{ items: Conversation[]; nextCursor: string | null }>>(
    { queryKey: queryKeys.conversationsAll },
    (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((c) => (c.id === id ? { ...c, ...patch } : c)),
            })),
          }
        : old,
  );

  const single = queryKeys.conversation(id);
  snapshot.push([single, queryClient.getQueryData(single)]);
  queryClient.setQueryData<Conversation>(single, (old) => (old ? { ...old, ...patch } : old));

  return snapshot;
}

function restoreConversations(
  queryClient: ReturnType<typeof useQueryClient>,
  snapshot: ConversationsSnapshot | undefined,
): void {
  if (!snapshot) return;
  for (const [key, data] of snapshot) queryClient.setQueryData(key, data);
}

export function usePinConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; pinned: boolean }) =>
      conversationsApi.setConversationPinned(vars.id, vars.pinned),
    onMutate: (vars) => ({ snapshot: patchConversationEverywhere(queryClient, vars.id, { pinned: vars.pinned }) }),
    onError: (_err, _vars, context) => restoreConversations(queryClient, context?.snapshot),
    onSuccess: (conversation) => {
      queryClient.setQueryData(queryKeys.conversation(conversation.id), conversation);
      // Still invalidated, because pinning REORDERS the list — the patch
      // above gets the row's state right, but only the server knows where
      // it now belongs. The reorder arrives a moment later; the state does
      // not have to wait for it.
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
    },
  });
}

export function useArchiveConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; status: ConversationStatus }) =>
      conversationsApi.setConversationStatus(vars.id, vars.status),
    onMutate: (vars) => ({ snapshot: patchConversationEverywhere(queryClient, vars.id, { status: vars.status }) }),
    onError: (_err, _vars, context) => restoreConversations(queryClient, context?.snapshot),
    onSuccess: (conversation) => {
      queryClient.setQueryData(queryKeys.conversation(conversation.id), conversation);
      // Archiving moves the row out of this view entirely, which the patch
      // cannot do on its own — the filter lives server-side.
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
    },
  });
}

/** "Mark as unread" — the inverse of opening the chat, which clears it. */
export function useMarkConversationUnread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => conversationsApi.markConversationUnread(id),
    // manuallyUnread, not unreadCount: the two are deliberately separate on
    // the model so the badge can keep showing the real number of unread
    // messages while the row reads as unread. Writing a fake count here
    // would put a wrong number on screen for the length of the round trip.
    onMutate: (id) => ({ snapshot: patchConversationEverywhere(queryClient, id, { manuallyUnread: true }) }),
    onError: (_err, _vars, context) => restoreConversations(queryClient, context?.snapshot),
    onSuccess: (conversation) => {
      queryClient.setQueryData(queryKeys.conversation(conversation.id), conversation);
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
    },
  });
}

/**
 * One action across a selection of chats.
 *
 * The whole list is invalidated rather than patched: a bulk archive or
 * delete changes which rows belong in the current view at all, and
 * reconciling that by hand across an infinite query's pages is more likely
 * to leave a ghost row than a refetch is to be slow.
 */
export function useBulkConversations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { ids: string[]; action: conversationsApi.BulkConversationAction }) =>
      conversationsApi.bulkUpdateConversations(vars.ids, vars.action),
    onSuccess: (_result, vars) => {
      if (vars.action === 'delete') {
        for (const id of vars.ids) queryClient.removeQueries({ queryKey: queryKeys.messages(id) });
        dropCachedMessages(vars.ids);
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
    },
  });
}
