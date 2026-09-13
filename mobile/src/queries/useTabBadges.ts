import { useMemo } from 'react';
import { useConversations, flattenConversations } from './useConversations';
import { useCallHistory, flattenCalls } from './useCalls';
import { useCallsSeenStore } from '../store/callsSeenStore';

/**
 * The two numbers on the tab bar.
 *
 * Both are derived from queries the tabs already run, so this adds no
 * request of its own: the conversation list is the same cache the Chats
 * tab renders and RealtimeSync patches on every incoming message, which
 * is what makes the badge move the moment a message lands rather than on
 * the next refetch.
 */
export function useTabBadges(): { unreadChats: number; missedCalls: number } {
  // The same parameters the Chats tab uses, so this shares its cache
  // entry rather than opening a second one that would fetch separately
  // and then disagree with the list the user is looking at.
  const conversations = useConversations({ status: 'OPEN' });
  const calls = useCallHistory();
  const seenAt = useCallsSeenStore((s) => s.seenAt);

  const unreadChats = useMemo(
    () =>
      flattenConversations(conversations.data).reduce(
        // A conversation marked unread by hand has no unread messages to
        // count, but it is still one thing waiting — so it counts as one.
        (total, c) => total + (c.unreadCount || (c.manuallyUnread ? 1 : 0)),
        0,
      ),
    [conversations.data],
  );

  const missedCalls = useMemo(() => {
    const since = seenAt ? Date.parse(seenAt) : 0;
    return flattenCalls(calls.data).filter(
      (c) =>
        c.direction === 'INBOUND' &&
        c.status === 'MISSED' &&
        // A call recorded before the tab was last opened has been seen.
        Date.parse(c.createdAt) > since,
    ).length;
  }, [calls.data, seenAt]);

  return { unreadChats, missedCalls };
}
