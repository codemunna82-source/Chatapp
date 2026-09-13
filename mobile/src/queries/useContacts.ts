import { keepPreviousData, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as contactsApi from '../api/endpoints/contacts';
import type { ListContactsParams } from '../api/endpoints/contacts';
import type { Contact } from '../api/types';
import { queryKeys } from './keys';

export function useContacts(params: Omit<ListContactsParams, 'cursor'> = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.contacts(params),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      contactsApi.listContacts({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // Same reasoning as useConversations: keep the current results visible
    // while a search refines rather than blanking the list per keystroke.
    placeholderData: keepPreviousData,
  });
}

export function flattenContacts(data: ReturnType<typeof useContacts>['data']): Contact[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: contactsApi.createContact,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

export function useUpdateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: contactsApi.updateContact,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

/** Deletes a contact (and, server-side, their conversations and messages). */
export function useDeleteContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => contactsApi.deleteContact(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contacts'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
      // And the single-conversation queries, by prefix. The chat header
      // reads the contact's avatarUpdatedAt from THAT query, not from the
      // list — so without this a photo set from the header uploaded fine
      // and then did not appear until the screen was reopened, which
      // looks exactly like a failed upload.
      void queryClient.invalidateQueries({ queryKey: ['conversation'] });
    },
  });
}

/**
 * Uploads a photo for a contact.
 *
 * Invalidates the contact lists so every row's Avatar re-reads
 * `avatarUpdatedAt` — that value is the cache-busting query param on the
 * photo URL, so without the invalidation the old photo would keep showing
 * at the unchanged URL.
 */
export function useUploadContactAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: contactsApi.PickedPhoto }) =>
      contactsApi.uploadContactAvatar(id, file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contacts'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
    },
  });
}
