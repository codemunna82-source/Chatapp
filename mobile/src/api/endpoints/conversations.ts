import { apiClient } from '../client';
import type { ApiSuccess, Conversation, ConversationStatus } from '../types';

export interface ListConversationsParams {
  search?: string;
  cursor?: string;
  limit?: number;
  pinnedOnly?: boolean;
  status?: ConversationStatus;
}

export async function listConversations(
  params: ListConversationsParams,
): Promise<{ items: Conversation[]; nextCursor: string | null }> {
  const res = await apiClient.get<ApiSuccess<Conversation[]>>('/conversations', { params });
  return { items: res.data.data, nextCursor: res.data.meta?.nextCursor ?? null };
}

export async function getConversation(id: string): Promise<Conversation> {
  const res = await apiClient.get<ApiSuccess<Conversation>>(`/conversations/${id}`);
  return res.data.data;
}

export async function setConversationPinned(id: string, pinned: boolean): Promise<Conversation> {
  const res = await apiClient.patch<ApiSuccess<Conversation>>(`/conversations/${id}`, { pinned });
  return res.data.data;
}

/** Opens (creating if needed) the conversation with a contact — the app's "new chat" action. */
export async function startConversation(contactId: string): Promise<Conversation> {
  const res = await apiClient.post<ApiSuccess<Conversation>>('/conversations', { contactId });
  return res.data.data;
}

/** Deletes a chat and its messages from this workspace (not from the customer's WhatsApp). */
export async function deleteConversation(id: string): Promise<void> {
  await apiClient.delete(`/conversations/${id}`);
}

export async function setConversationStatus(id: string, status: ConversationStatus): Promise<Conversation> {
  const res = await apiClient.patch<ApiSuccess<Conversation>>(`/conversations/${id}`, { status });
  return res.data.data;
}

/**
 * "Mark as unread". Only ever sets the flag — clearing it is what opening
 * the chat does, so there is no `false` counterpart to send.
 */
export async function markConversationUnread(id: string): Promise<Conversation> {
  const res = await apiClient.patch<ApiSuccess<Conversation>>(`/conversations/${id}`, { manuallyUnread: true });
  return res.data.data;
}

export type BulkConversationAction = 'archive' | 'unarchive' | 'delete' | 'read';

export interface BulkConversationResult {
  action: BulkConversationAction;
  /** How many of the requested chats actually changed. Lower than the
   *  number selected when some were already deleted elsewhere. */
  affected: number;
}

/** One action across a hand-selected set of chats, in a single request. */
export async function bulkUpdateConversations(
  ids: string[],
  action: BulkConversationAction,
): Promise<BulkConversationResult> {
  const res = await apiClient.post<ApiSuccess<BulkConversationResult>>('/conversations/bulk', { ids, action });
  return res.data.data;
}
