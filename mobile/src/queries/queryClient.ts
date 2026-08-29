import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      // In React Native this is driven by focusManager, which RealtimeSync
      // wires to AppState — "window focus" means the app coming back to the
      // foreground, not a browser tab. It was previously off on the
      // assumption that it only applied to browsers, which left the app
      // showing whatever it had cached before being backgrounded.
      refetchOnWindowFocus: true,
      // Same reasoning: onlineManager is wired to NetInfo in RealtimeSync,
      // so a query that failed while offline retries when the link returns
      // instead of sitting on its error until the user pulls to refresh.
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0, // never silently retry a write (e.g. a message send) — surface the failure instead
    },
  },
});
