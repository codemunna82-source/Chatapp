import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as whatsappApi from '../api/endpoints/whatsapp';
import { queryKeys } from './keys';

/**
 * The workspace's WhatsApp numbers.
 *
 * `enabled` because the endpoint is MASTER_ADMIN-only: mounting this in a
 * screen a SUB_USER can reach would fire a request that always 403s.
 */
export function useWhatsAppNumbers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.whatsappNumbers,
    queryFn: whatsappApi.listWhatsAppNumbers,
    enabled,
    // Numbers change when a WABA is connected — rare, and never from this
    // screen — so re-fetching on every sheet open is pure latency.
    staleTime: 5 * 60 * 1000,
  });
}

export function useRegisterWhatsAppNumber() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: whatsappApi.registerWhatsAppNumber,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.whatsappNumbers });
    },
  });
}

/** Completes Meta's registration for a number that is still "Pending". */
export function useRegisterNumberForCloudApi() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => whatsappApi.registerNumberForCloudApi(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.whatsappNumbers });
    },
  });
}
