import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as notificationsApi from '../api/endpoints/notifications';
import { queryKeys } from './keys';

export function useNotifications(unreadOnly = false) {
  return useInfiniteQuery({
    queryKey: queryKeys.notifications(unreadOnly),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      notificationsApi.listNotifications({ cursor: pageParam, unreadOnly }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function flattenNotifications(data: ReturnType<typeof useNotifications>['data']) {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: notificationsApi.markNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: notificationsApi.markAllNotificationsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
