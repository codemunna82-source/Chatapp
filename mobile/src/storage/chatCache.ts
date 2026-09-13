import { MMKV } from 'react-native-mmkv';
import type { Conversation, Message } from '../api/types';

/**
 * The chat's own on-disk cache: the last page of every conversation, and
 * the conversation list itself.
 *
 * WHY MMKV RATHER THAN SQLITE. The app already depends on MMKV — it backs
 * the outbox and every preference — so this adds no dependency, and its
 * reads are SYNCHRONOUS. That is the whole point: a chat can be painted
 * with real messages in its first render pass, with no await, no loading
 * state and no skeleton that flashes for one frame. SQLite would win if
 * this needed queries — search across every conversation, aggregates,
 * partial indexes — but search is already a server endpoint and the UI
 * only ever reads "the newest page of one conversation", which is a key
 * lookup. A query engine for one key lookup is a dependency, a native
 * module and an async boundary bought for nothing.
 *
 * Its own MMKV instance rather than the preferences one, for two
 * reasons: this is the only store holding customer message content, so
 * clearing it on sign-out must not take someone's theme with it, and a
 * few megabytes of chat history does not belong in the file every
 * preference read maps.
 */
const chatStore = new MMKV({ id: 'voxo-chat-cache' });

/**
 * How much of a conversation is kept.
 *
 * One page's worth, near enough: this exists so the thread is on screen
 * instantly, not so the whole history is available offline. The server
 * pages the rest in as the user scrolls, and keeping thousands of
 * messages per conversation would trade the thing this is for — a fast
 * first paint — against the memory MMKV maps to get it.
 */
const MESSAGES_PER_CONVERSATION = 50;

/** Hard cap on the cached list, so one enormous page cannot fill the store. */
const CACHED_CONVERSATIONS = 60;

/**
 * How many conversations keep a cached page at all, least-recently-written
 * dropped first.
 *
 * Without a bound this grows for the life of the install: a workspace that
 * has talked to four thousand customers would map four thousand pages of
 * message JSON to open one chat.
 */
const MAX_CACHED_THREADS = 80;

const INDEX_KEY = 'threads.index';
const CONVERSATIONS_KEY = 'conversations';

function messagesKey(conversationId: string): string {
  return `msgs.${conversationId}`;
}

interface Cached<T> {
  /** When this was written, so React Query can treat it as the age it is. */
  at: number;
  items: T[];
  /**
   * Where the page that follows this one begins, or null when there is
   * nothing older.
   *
   * Kept because a restored page has to be able to scroll back. Without a
   * cursor the query would come up believing the conversation ends at the
   * fiftieth message, and pulling up would do nothing until the network
   * replaced the whole thing.
   */
  nextCursor: string | null;
}

function read<T>(key: string): Cached<T> | null {
  const raw = chatStore.getString(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Cached<T>;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return { ...parsed, nextCursor: parsed.nextCursor ?? null };
  } catch {
    // A half-written or version-skewed blob is not worth recovering, and
    // throwing here would take down the screen it was meant to speed up.
    return null;
  }
}

/** Newest-first, exactly as the API returns and the list renders. */
export function readCachedMessages(conversationId: string): Cached<Message> | null {
  return read<Message>(messagesKey(conversationId));
}

/**
 * @param nextCursor where the server said the next page begins for the
 * data being written, or null if it had reached the end.
 */
export function writeCachedMessages(
  conversationId: string,
  items: Message[],
  nextCursor: string | null,
): void {
  // Optimistic rows are not history. A QUEUED bubble restored from disk
  // would sit there forever claiming to be sending, with nothing left to
  // send it — the outbox is the durable record of an unsent message, and
  // it is a separate store for exactly that reason.
  const durable = items.filter((m) => m.status !== 'QUEUED' && m.status !== 'FAILED');
  if (durable.length === 0) return;

  const kept = durable.slice(0, MESSAGES_PER_CONVERSATION);
  // Truncating the tail moves the boundary: the restored page now ends at
  // the last message kept, so that message's id is where the next page
  // starts — which is exactly the cursor the server itself would have
  // returned for a page ending there.
  const cursor = durable.length > kept.length ? (kept[kept.length - 1]!.id ?? null) : nextCursor;

  chatStore.set(
    messagesKey(conversationId),
    JSON.stringify({ at: Date.now(), items: kept, nextCursor: cursor }),
  );
  touchThread(conversationId);
}

export function readCachedConversations(): Cached<Conversation> | null {
  return read<Conversation>(CONVERSATIONS_KEY);
}

/**
 * Stores the list's FIRST page, exactly as the server returned it.
 *
 * The first page and not the flattened scroll, because a conversation
 * cursor is an opaque composite the server builds from three fields
 * (pinned, updatedAt, id) — unlike a message cursor, the client cannot
 * derive one for a position it invented by truncating. Keeping a real
 * page with its real cursor means the restored list can page on from
 * where it stops; keeping more rows than the server sent would mean
 * keeping them with no way to continue past them.
 */
export function writeCachedConversations(items: Conversation[], nextCursor: string | null): void {
  if (items.length === 0) return;
  const kept = items.slice(0, CACHED_CONVERSATIONS);
  // Only if the cap actually bit, which needs a page larger than sixty.
  const cursor = items.length > kept.length ? null : nextCursor;
  chatStore.set(
    CONVERSATIONS_KEY,
    JSON.stringify({ at: Date.now(), items: kept, nextCursor: cursor }),
  );
}

/**
 * Moves a thread to the front of the index and evicts the oldest.
 *
 * The index is a plain array of ids, newest first — a list this short is
 * cheaper to rewrite whole than to maintain as anything cleverer.
 */
function touchThread(conversationId: string): void {
  const raw = chatStore.getString(INDEX_KEY);
  let ids: string[] = [];
  try {
    if (raw) ids = JSON.parse(raw) as string[];
  } catch {
    ids = [];
  }
  if (!Array.isArray(ids)) ids = [];

  const next = [conversationId, ...ids.filter((id) => id !== conversationId)];
  for (const evicted of next.slice(MAX_CACHED_THREADS)) {
    chatStore.delete(messagesKey(evicted));
  }
  chatStore.set(INDEX_KEY, JSON.stringify(next.slice(0, MAX_CACHED_THREADS)));
}

/**
 * Forgets one conversation's cached page.
 *
 * Called when a chat is deleted. Eviction would get there eventually, but
 * "eventually" is the wrong answer for message content the user has just
 * asked to be rid of.
 */
export function dropCachedMessages(conversationIds: string[]): void {
  if (conversationIds.length === 0) return;
  const gone = new Set(conversationIds);
  for (const id of gone) chatStore.delete(messagesKey(id));

  const raw = chatStore.getString(INDEX_KEY);
  if (!raw) return;
  try {
    const ids = JSON.parse(raw) as string[];
    if (!Array.isArray(ids)) return;
    chatStore.set(INDEX_KEY, JSON.stringify(ids.filter((id) => !gone.has(id))));
  } catch {
    chatStore.delete(INDEX_KEY);
  }
}

/**
 * Everything, gone.
 *
 * Called on sign-out. This is the only store in the app holding customer
 * message content, and leaving a previous user's conversations readable
 * on a shared phone is not a cache, it is a leak.
 */
export function clearChatCache(): void {
  chatStore.clearAll();
}
