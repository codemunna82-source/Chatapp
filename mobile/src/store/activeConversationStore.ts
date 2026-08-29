import { create } from 'zustand';

interface ActiveConversationState {
  activeConversationId: string | null;
  setActiveConversation: (id: string | null) => void;
}

/**
 * Which conversation the user is currently looking at.
 *
 * Exists so the new-message alert can stay quiet for the chat that is
 * already open: chiming at someone while they watch the bubble appear is
 * the fastest way to get the whole feature switched off.
 */
export const useActiveConversationStore = create<ActiveConversationState>((set) => ({
  activeConversationId: null,
  setActiveConversation: (id) => set({ activeConversationId: id }),
}));
