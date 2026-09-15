import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/endpoints/tenant';
import { queryKeys } from './keys';

export function useTenantSettings() {
  return useQuery({
    queryKey: queryKeys.tenantSettings,
    queryFn: api.getTenantSettings,
    // Workspace-wide settings nobody changes twice in a session.
    staleTime: 5 * 60_000,
  });
}

export function useUpdateBusinessProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.updateBusinessProfile,
    // The response already carries the newly resolved name, so the screen
    // can show the result without a second round trip — which matters
    // here, because the whole point of the screen is seeing what the
    // customer will see.
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.tenantSettings, (prev: api.TenantSettings | undefined) =>
        prev ? { ...prev, ...data } : prev,
      );
    },
  });
}

/**
 * The workspace's photo.
 *
 * Invalidates rather than patching the cache: the response carries only
 * the new version, and the screen has to re-read the settings anyway for
 * the preview to change. One refetch of a rarely-touched query is
 * cheaper than a patch that has to know the whole shape.
 */
export function useUploadBusinessAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.uploadBusinessAvatar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tenantSettings }),
  });
}

export function useRemoveBusinessAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.removeBusinessAvatar,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tenantSettings }),
  });
}
