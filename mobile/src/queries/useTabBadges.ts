import { useInfiniteQuery } from '@tanstack/react-query';
import * as conversationsApi from '../api/endpoints/conversations';
import * as callsApi from '../api/endpoints/calls';
import { queryKeys } from './keys';
import { useCallsSeenStore } from '../store/callsSeenStore';

/**
 * The two numbers on the tab bar.
 *
 * Both read caches the tabs already fill — the conversation list is the
 * same entry the Chats tab renders and RealtimeSync patches on every
 * incoming message, which is what makes the badge move as the message
 * lands rather than on the next refetch.
 *
 * `select` is not a nicety here. This hook runs at the ROOT of the tab
 * navigator, so without it every cache patch — every message, every status
 * change — handed the navigator a new data object and re-rendered all four
 * tabs for a number that had not changed. Reducing to a count inside
 * `select` means React Query compares two integers and the navigator only
 * re-renders when the badge genuinely differs.
 */
export function useTabBadges(): { unreadChats: number; missedCalls: number } {
  const seenAt = useCallsSeenStore((s) => s.seenAt);

  // The same parameters the Chats tab uses, so this shares its cache entry
  // rather than opening a second one that would fetch separately and then
  // disagree with the list the user is looking at.
  const unread = useInfiniteQuery({
    queryKey: queryKeys.conversations({ status: 'OPEN' }),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      conversationsApi.listConversations({ status: 'OPEN', cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    select: (data) =>
      data.pages
        .flatMap((page) => page.items)
        // A conversation marked unread by hand has no unread messages to
        // count, but it is still one thing waiting — so it counts as one.
        .reduce((total, c) => total + (c.unreadCount || (c.manuallyUnread ? 1 : 0)), 0),
  });

  const missed = useInfiniteQuery({
    queryKey: queryKeys.calls,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      callsApi.listCalls({ cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // The call log is not a live feed: a missed call arrives as a socket
    // event that invalidates this key, so polling it on every foreground
    // would be a request for something already pushed.
    staleTime: 5 * 60_000,
    select: (data) => {
      const since = seenAt ? Date.parse(seenAt) : 0;
      return data.pages
        .flatMap((page) => page.items)
        .filter(
          (c) =>
            c.direction === 'INBOUND' &&
            c.status === 'MISSED' &&
            // Recorded before the tab was last opened: already seen.
            Date.parse(c.createdAt) > since,
        ).length;
    },
  });

  return { unreadChats: unread.data ?? 0, missedCalls: missed.data ?? 0 };
}
