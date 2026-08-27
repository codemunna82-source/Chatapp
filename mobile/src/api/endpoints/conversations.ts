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

export async function setConversationStatus(id: string, status: ConversationStatus): Promise<Conversation> {
  const res = await apiClient.patch<ApiSuccess<Conversation>>(`/conversations/${id}`, { status });
  return res.data.data;
}
