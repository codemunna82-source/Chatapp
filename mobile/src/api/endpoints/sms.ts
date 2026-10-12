import { apiClient } from '../client';
import type { ApiSuccess, Message } from '../types';

export interface SmsSyncItem {
  phone: string;
  body: string;
  /** Epoch milliseconds — the device's own SMS timestamp, not when this syncs. */
  date: number;
  direction: 'IN' | 'OUT';
  /** This message's own stable id — see smsSync.ts for how it's built. */
  clientMessageId: string;
}

/** POST /api/sms/sync — see the backend's sms.service.ts for what this actually does. */
export async function syncSms(messages: SmsSyncItem[]): Promise<{ created: number }> {
  const res = await apiClient.post<ApiSuccess<{ created: number }>>('/sms/sync', { messages });
  return res.data.data;
}

/**
 * GET /api/sms/conversation — find-or-create, for the lead-SMS
 * notification's deep link (see SmsThreadScreen.tsx), which has only a
 * phone number and needs a real conversation id to navigate to.
 */
export async function resolveSmsConversation(phone: string): Promise<{ conversationId: string }> {
  const res = await apiClient.get<ApiSuccess<{ conversationId: string }>>('/sms/conversation', { params: { phone } });
  return res.data.data;
}

/**
 * POST /api/sms/send — records one SMS this phone just sent natively
 * (see useSendSmsMessage in useMessages.ts) and returns the real,
 * persisted Message, the same way messagesApi.sendMessage does for a
 * WhatsApp send — so the SMS composer can swap its optimistic bubble
 * for the authoritative one immediately rather than waiting on the
 * next realtime push or background sync pass.
 */
export async function sendSms(item: SmsSyncItem): Promise<Message> {
  const res = await apiClient.post<ApiSuccess<Message>>('/sms/send', item);
  return res.data.data;
}
