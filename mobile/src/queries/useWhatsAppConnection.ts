import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/endpoints/whatsappConnect';
import { queryKeys } from './keys';

export function useWhatsAppConnection() {
  return useQuery({
    queryKey: queryKeys.whatsappConnection,
    queryFn: api.getWhatsAppConnection,
  });
}

/** Invalidates everything a new connection changes: the status card, the
 *  admin's number list, and the chat list — which is now scoped to the
 *  number this user just connected. */
function useConnectionInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.whatsappConnection });
    void queryClient.invalidateQueries({ queryKey: queryKeys.whatsappNumbers });
    void queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll });
  };
}

export function useConnectWhatsApp() {
  const invalidate = useConnectionInvalidation();
  return useMutation({ mutationFn: api.connectWhatsApp, onSuccess: invalidate });
}

export function useDisconnectWhatsApp() {
  const invalidate = useConnectionInvalidation();
  return useMutation({ mutationFn: api.disconnectWhatsApp, onSuccess: invalidate });
}
