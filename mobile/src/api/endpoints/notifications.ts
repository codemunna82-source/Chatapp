import { apiClient } from '../client';
import type { ApiSuccess, AppNotification } from '../types';

export interface ListNotificationsParams {
  cursor?: string;
  limit?: number;
  unreadOnly?: boolean;
}

export async function listNotifications(
  params: ListNotificationsParams,
): Promise<{ items: AppNotification[]; nextCursor: string | null }> {
  const res = await apiClient.get<ApiSuccess<AppNotification[]>>('/notifications', { params });
  return { items: res.data.data, nextCursor: res.data.meta?.nextCursor ?? null };
}

export async function markNotificationRead(id: string): Promise<AppNotification> {
  const res = await apiClient.patch<ApiSuccess<AppNotification>>(`/notifications/${id}/read`);
  return res.data.data;
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  const res = await apiClient.post<ApiSuccess<{ updated: number }>>('/notifications/read-all');
  return res.data.data;
}
