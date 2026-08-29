import { apiClient } from '../client';
import type { ApiSuccess, Message } from '../types';

export interface ListMessagesParams {
  cursor?: string;
  limit?: number;
  /** Case-insensitive substring match against message text. */
  search?: string;
  starredOnly?: boolean;
}

export async function listMessages(
  conversationId: string,
  params: ListMessagesParams,
): Promise<{ items: Message[]; nextCursor: string | null }> {
  const res = await apiClient.get<ApiSuccess<Message[]>>(`/conversations/${conversationId}/messages`, { params });
  return { items: res.data.data, nextCursor: res.data.meta?.nextCursor ?? null };
}

/** Mirrors the backend's discriminated union exactly (backend/src/modules/messages/message.validation.ts). */
export type SendMessageBody =
  | { type: 'text'; text: string; replyToMessageId?: string }
  | { type: 'template'; templateName: string; languageCode: string; templateComponents?: unknown[] }
  | {
      type: 'image' | 'video' | 'audio' | 'document';
      mediaId?: string;
      mediaLink?: string;
      caption?: string;
      filename?: string;
      replyToMessageId?: string;
    }
  | { type: 'reaction'; reactToMessageId: string; emoji: string };

export async function sendMessage(conversationId: string, body: SendMessageBody): Promise<Message> {
  const res = await apiClient.post<ApiSuccess<Message>>(`/conversations/${conversationId}/messages`, body);
  return res.data.data;
}

/**
 * "Delete for me" — hides the message from this workspace only. There is no
 * delete-for-everyone: Meta's Cloud API cannot recall a delivered message.
 */
export async function deleteMessage(conversationId: string, messageId: string): Promise<void> {
  await apiClient.delete(`/conversations/${conversationId}/messages/${messageId}`);
}

/**
 * Stars or unstars a message. Workspace-wide, not per-user: this is a
 * shared inbox, and a flagged message matters to whoever picks the
 * conversation up next.
 */
export async function starMessage(
  conversationId: string,
  messageId: string,
  starred: boolean,
): Promise<Message> {
  const res = await apiClient.patch<ApiSuccess<Message>>(
    `/conversations/${conversationId}/messages/${messageId}/star`,
    { starred },
  );
  return res.data.data;
}
