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
/**
 * This send's own id, stable across every retry of it.
 *
 * The outbox retries a send it never got a response to — and it cannot
 * tell that apart from a send that arrived and whose response was lost.
 * The server stores this id under a unique index and hands back the
 * message it already has, so the retry becomes a lookup instead of a
 * second copy in the customer's WhatsApp.
 */
type WithClientId = { clientMessageId?: string };

export type SendMessageBody =
  | ({ type: 'text'; text: string; replyToMessageId?: string } & WithClientId)
  | ({
      type: 'template';
      templateName: string;
      languageCode: string;
      templateComponents?: unknown[];
    } & WithClientId)
  | ({
      type: 'image' | 'video' | 'audio' | 'document';
      mediaId?: string;
      mediaLink?: string;
      caption?: string;
      filename?: string;
      replyToMessageId?: string;
    } & WithClientId)
  | ({
      type: 'location';
      /** Nested, matching what the server validates and stores. */
      location: { latitude: number; longitude: number; name?: string; address?: string };
      replyToMessageId?: string;
    } & WithClientId)
  | ({ type: 'reaction'; reactToMessageId: string; emoji: string } & WithClientId);

export async function sendMessage(conversationId: string, body: SendMessageBody): Promise<Message> {
  const res = await apiClient.post<ApiSuccess<Message>>(`/conversations/${conversationId}/messages`, body);
  return res.data.data;
}

/**
 * Removes a message.
 *
 * 'me' hides it from this workspace and nothing more. 'everyone'
 * withdraws it from the customer's screen too, and the server allows
 * that only for this workspace's own recent messages on the private web
 * chat — Meta's Cloud API cannot recall a delivered WhatsApp message, so
 * the server refuses those with a reason worth showing.
 *
 * The scope travels in the query string rather than a body: a DELETE
 * with a body is dropped by enough intermediaries to be a bad place for
 * the field that decides whether someone else's copy disappears.
 */
export async function deleteMessage(
  conversationId: string,
  messageId: string,
  scope: 'me' | 'everyone' = 'me',
): Promise<void> {
  await apiClient.delete(`/conversations/${conversationId}/messages/${messageId}`, {
    params: { scope },
  });
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
