import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as teamApi from '../api/endpoints/team';
import { queryKeys } from './keys';
import type { UserStatus } from '../api/types';

export function useTeamMembers(status?: UserStatus) {
  return useInfiniteQuery({
    queryKey: queryKeys.team(status),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => teamApi.listTeamMembers({ status, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function flattenTeamMembers(data: ReturnType<typeof useTeamMembers>['data']) {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

export function useCreateTeamMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: teamApi.createTeamMember,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['team'] });
    },
  });
}

export function useUpdateTeamMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: teamApi.updateTeamMember,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['team'] });
    },
  });
}

export function useDisableTeamMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: teamApi.disableTeamMember,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['team'] });
    },
  });
}
