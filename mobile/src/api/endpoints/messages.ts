import { apiClient } from '../client';
import type { ApiSuccess, Message } from '../types';

export interface ListMessagesParams {
  cursor?: string;
  limit?: number;
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
