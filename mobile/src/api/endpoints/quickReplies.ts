import { apiClient } from '../client';
import type { ApiSuccess, QuickReply } from '../types';

export async function listQuickReplies(): Promise<QuickReply[]> {
  const res = await apiClient.get<ApiSuccess<QuickReply[]>>('/quick-replies');
  return res.data.data;
}

export async function createQuickReply(body: { title: string; body: string }): Promise<QuickReply> {
  const res = await apiClient.post<ApiSuccess<QuickReply>>('/quick-replies', body);
  return res.data.data;
}

export async function updateQuickReply(
  id: string,
  updates: { title?: string; body?: string },
): Promise<QuickReply> {
  const res = await apiClient.patch<ApiSuccess<QuickReply>>(`/quick-replies/${id}`, updates);
  return res.data.data;
}

export async function deleteQuickReply(id: string): Promise<void> {
  await apiClient.delete(`/quick-replies/${id}`);
}

/** Bumps the usage counter that orders the picker. Deliberately separate
 *  from sending: the message must go out whether or not this succeeds. */
export async function recordQuickReplyUse(id: string): Promise<void> {
  await apiClient.post(`/quick-replies/${id}/use`);
}
