import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
    },
  });
}
