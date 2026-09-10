import { create } from 'zustand';

interface GuestPresenceState {
  /** Conversation ids whose customer currently has the web chat window open. */
  open: Record<string, true>;
  setGuestOpen: (conversationId: string, online: boolean) => void;
  /**
   * Forgotten on sign-out and on a socket reconnect.
   *
   * Presence is only ever true because a socket said so, and a socket that
   * dropped stopped saying anything. Keeping the old set across a
   * reconnect would show a green dot beside a customer who closed the tab
   * during the outage — the one thing a presence indicator must not do.
   */
  reset: () => void;
}

export const useGuestPresenceStore = create<GuestPresenceState>((set) => ({
  open: {},
  setGuestOpen: (conversationId, online) =>
    set((state) => {
      if (online) {
        if (state.open[conversationId]) return state;
        return { open: { ...state.open, [conversationId]: true } };
      }
      if (!state.open[conversationId]) return state;
      const next = { ...state.open };
      delete next[conversationId];
      return { open: next };
    }),
  reset: () => set({ open: {} }),
}));

/** Read outside React — the realtime layer decides from it before navigating. */
export function isGuestWindowOpen(conversationId: string): boolean {
  return Boolean(useGuestPresenceStore.getState().open[conversationId]);
}
