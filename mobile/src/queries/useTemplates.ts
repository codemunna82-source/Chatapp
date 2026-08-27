import { useQuery } from '@tanstack/react-query';
import * as templatesApi from '../api/endpoints/templates';
import { queryKeys } from './keys';

export function useTemplates() {
  return useQuery({
    queryKey: queryKeys.templates,
    queryFn: templatesApi.listTemplates,
    staleTime: 5 * 60_000, // templates change rarely — Meta approval isn't instant
  });
}
