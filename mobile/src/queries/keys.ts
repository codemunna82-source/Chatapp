import type { ListConversationsParams } from '../api/endpoints/conversations';
import type { ListContactsParams } from '../api/endpoints/contacts';

/** Centralized so the socket-driven cache patches (RealtimeSync) target exactly what the hooks query. */
export const queryKeys = {
  conversations: (params: Omit<ListConversationsParams, 'cursor'>) => ['conversations', params] as const,
  conversationsAll: ['conversations'] as const,
  conversation: (id: string) => ['conversation', id] as const,
  messages: (conversationId: string) => ['messages', conversationId] as const,
  /** Every conversation's message list — used to resync after a socket gap. */
  messagesAll: ['messages'] as const,
  /** Search / starred views, kept separate from the main thread's cache. */
  messagesFiltered: (conversationId: string, filter: { search?: string; starredOnly?: boolean }) =>
    ['messagesFiltered', conversationId, { search: filter.search ?? '', starredOnly: filter.starredOnly ?? false }] as const,
  messagesFilteredAll: (conversationId: string) => ['messagesFiltered', conversationId] as const,
  contacts: (params: Omit<ListContactsParams, 'cursor'>) => ['contacts', params] as const,
  templates: ['templates'] as const,
  quickReplies: ['quickReplies'] as const,
  wallet: ['wallet'] as const,
  walletTransactions: ['walletTransactions'] as const,
  notifications: (unreadOnly?: boolean) => ['notifications', { unreadOnly: unreadOnly ?? false }] as const,
  subscription: ['subscription'] as const,
  dashboard: ['dashboard'] as const,
  calls: ['calls'] as const,
  team: (status?: string) => ['team', { status: status ?? null }] as const,
};
