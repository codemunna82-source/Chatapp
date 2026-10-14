import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './keys';
import {
  deleteSmsThread,
  getSmsMessages,
  getSmsThreads,
  markSmsThreadRead,
  smsStoreAvailable,
  type StoredSms,
  type StoredSmsThread,
} from '../native/smsStore';
import { sendSmsAutomatically } from '../utils/sendSms';
import type { Conversation, Message } from '../api/types';
import { outgoingStatus } from '../utils/smsMerge';
export { mergeSmsIntoConversation, phoneThreadKey } from '../utils/smsMerge';

/** Prefix that marks a chat-list row or message as coming from the local SMS store, not the API. */
export const LOCAL_SMS_ID_PREFIX = 'sms:';

export function isLocalSmsId(id: string): boolean {
  return id.startsWith(LOCAL_SMS_ID_PREFIX);
}

const THREAD_LIMIT = 500;
const MESSAGE_LIMIT = 500;

/**
 * A local SMS thread in the shape ChatListItem already renders, so the list
 * row looks exactly like every other chat. Only the fields the row reads
 * carry meaning; the rest are neutral defaults.
 */
export function threadToConversation(thread: StoredSmsThread): Conversation {
  const id = `${LOCAL_SMS_ID_PREFIX}${thread.threadKey}`;
  const iso = new Date(thread.timestamp).toISOString();
  return {
    id,
    tenantId: '',
    contactId: id,
    contact: {
      id,
      tenantId: '',
      phone: thread.address,
      tags: [],
      isDemo: false,
      blocked: false,
      createdAt: iso,
      updatedAt: iso,
    },
    whatsappPhoneNumberId: null,
    lastMessageAt: iso,
    lastMessagePreview: thread.body,
    lastMessageDirection: thread.direction,
    lastMessageStatus: thread.direction === 'OUT' ? outgoingStatus(thread.status) : undefined,
    withinCustomerServiceWindow: true,
    isDemo: false,
    unreadCount: thread.unreadCount,
    manuallyUnread: false,
    pinned: false,
    status: 'OPEN',
    createdAt: iso,
    updatedAt: iso,
  };
}

export function smsToMessage(sms: StoredSms): Message {
  const iso = new Date(sms.timestamp).toISOString();
  return {
    id: `${LOCAL_SMS_ID_PREFIX}${sms.id}`,
    conversationId: `${LOCAL_SMS_ID_PREFIX}${sms.threadKey}`,
    direction: sms.direction,
    type: 'text',
    text: sms.body,
    status: sms.direction === 'OUT' ? outgoingStatus(sms.status) : 'READ',
    sentAt: iso,
    channel: 'sms',
    createdAt: iso,
  };
}

/** The address a list row was built from — what the thread screen and the native module key on. */
export function addressOfLocalConversation(conversation: Conversation): string {
  return conversation.contact?.phone ?? conversation.id.slice(LOCAL_SMS_ID_PREFIX.length);
}

export function useLocalSmsThreads(enabled = true) {
  return useQuery({
    queryKey: queryKeys.localSmsThreads,
    queryFn: () => getSmsThreads(THREAD_LIMIT),
    enabled: enabled && smsStoreAvailable,
    // Fresh data comes from native events and the resume reload, never a timer.
    staleTime: Infinity,
  });
}

export function useLocalSmsMessages(address: string) {
  return useQuery({
    queryKey: queryKeys.localSmsMessages(address),
    queryFn: async () => (await getSmsMessages(address, MESSAGE_LIMIT)).map(smsToMessage),
    enabled: smsStoreAvailable && Boolean(address),
    staleTime: Infinity,
  });
}

export function useMarkSmsThreadRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (address: string) => markSmsThreadRead(address),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.localSmsThreads }),
  });
}

export function useDeleteSmsThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (address: string) => deleteSmsThread(address),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.localSmsAll }),
  });
}

/**
 * Sends off this phone's SIM. On success the native side has already written
 * the message into the local store and fired the new-message event, so the
 * bubble arrives through the same path as an incoming one; the invalidation
 * here only covers a UI that was not subscribed.
 */
export function useSendLocalSms(address: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (text: string) => {
      const ok = await sendSmsAutomatically(address, text);
      if (!ok) throw new Error('SMS not sent');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.localSmsAll }),
  });
}
