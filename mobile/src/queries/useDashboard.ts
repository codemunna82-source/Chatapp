import { useQuery } from '@tanstack/react-query';
import * as dashboardApi from '../api/endpoints/dashboard';
import { queryKeys } from './keys';

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: dashboardApi.getDashboard,
    staleTime: 60_000,
  });
}
