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
