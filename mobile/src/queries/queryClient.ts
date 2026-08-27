import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false, // no browser windows on Android; irrelevant, keep off explicitly
    },
    mutations: {
      retry: 0, // never silently retry a write (e.g. a message send) — surface the failure instead
    },
  },
});
