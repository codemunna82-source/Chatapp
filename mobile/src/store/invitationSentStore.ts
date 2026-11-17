import { create } from 'zustand';

interface InvitationSentState {
  /** Conversation id → when the server last told us an invitation went
   *  out on it (Date.now() at the moment the socket event arrived). */
  sentAt: Record<string, number>;
  markInvitationSent: (conversationId: string) => void;
}

/**
 * The private-chat invitation is sent `internal` and never appears as a
 * message bubble (see guestAutoReply.service.ts) — without this, an agent
 * had no live sign it happened at all. The server's `invitation:sent`
 * socket event (RealtimeSync.tsx) writes a timestamp here; Composer.tsx
 * reads it to show a brief "invitation sent" banner in its own place
 * rather than the agent discovering it only once a nudge-limit reply
 * attempt explains it after the fact.
 *
 * A timestamp rather than a boolean so the composer can tell a FRESH
 * event (show the banner) from one it already showed for and timed out —
 * otherwise reopening a chat whose invitation went out five minutes ago
 * would show the banner again on every mount.
 */
export const useInvitationSentStore = create<InvitationSentState>((set) => ({
  sentAt: {},
  markInvitationSent: (conversationId) =>
    set((state) => ({ sentAt: { ...state.sentAt, [conversationId]: Date.now() } })),
}));
