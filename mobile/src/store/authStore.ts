import { create } from 'zustand';
import { getStoredTokens, setStoredTokens, clearStoredTokens } from '../storage/secureStorage';
import { getJSON, setJSON, remove as removeCached } from '../storage/mmkv';
import { setAuthHandlers } from '../api/client';
import * as authApi from '../api/endpoints/auth';
import type { AuthTokens, AuthUser } from '../api/types';
import { setSentryUser } from '../lib/sentry';
import { clearChatCache } from '../storage/chatCache';

const CACHED_USER_KEY = 'voxo.cachedUser';

export type AuthStatus = 'hydrating' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  /**
   * Why the last session ended, when it ended for a reason worth telling
   * someone about — an admin turning their number's access off, for
   * instance. Null for an ordinary sign-out.
   *
   * Kept in the store rather than passed through navigation params: the
   * sign-out happens inside an API interceptor, which has no navigation
   * to pass anything to.
   */
  signedOutReason: string | null;
  /** Reads persisted tokens/user at app startup — call once from the root component. */
  hydrate: () => Promise<void>;
  setSession: (tokens: AuthTokens) => Promise<void>;
  clearSession: (reason?: string) => Promise<void>;
  /** Merges a partial update into the cached user (e.g. avatarUpdatedAt after an upload) without a full re-login. */
  updateUser: (patch: Partial<AuthUser>) => void;
  /** Re-reads role/permissions from the server — see the implementation. */
  refreshUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'hydrating',
  accessToken: null,
  refreshToken: null,
  user: null,
  signedOutReason: null,

  hydrate: async () => {
    const { accessToken, refreshToken } = await getStoredTokens();
    const user = getJSON<AuthUser>(CACHED_USER_KEY);

    if (accessToken && refreshToken && user) {
      // Ids only — never the email or display name. See setSentryUser.
      setSentryUser(user);
      set({ status: 'signedIn', accessToken, refreshToken, user, signedOutReason: null });
    } else {
      // Partial/corrupt state (e.g. tokens without a cached user) is
      // treated as signed out — never guess at a session.
      await clearStoredTokens();
      removeCached(CACHED_USER_KEY);
      clearChatCache();
      setSentryUser(null);
      set({ status: 'signedOut', accessToken: null, refreshToken: null, user: null });
    }
  },

  setSession: async (tokens: AuthTokens) => {
    await setStoredTokens(tokens.accessToken, tokens.refreshToken);
    setJSON(CACHED_USER_KEY, tokens.user);
    setSentryUser(tokens.user);
    set({
      status: 'signedIn',
      signedOutReason: null,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: tokens.user,
    });
  },

  clearSession: async (reason?: string) => {
    await clearStoredTokens();
    removeCached(CACHED_USER_KEY);
    // The on-disk chat cache holds customer message content. Leaving it
    // for whoever signs in next — on a shared phone, or after an admin
    // revokes access — is not a cache, it is a leak.
    clearChatCache();
    // Cleared on the way out so a crash after signing out is not still
    // attributed to the person who just left.
    setSentryUser(null);
    set({
      status: 'signedOut',
      accessToken: null,
      refreshToken: null,
      user: null,
      signedOutReason: reason ?? null,
    });
  },

  updateUser: (patch: Partial<AuthUser>) => {
    const current = get().user;
    if (!current) return;
    const updated = { ...current, ...patch };
    setJSON(CACHED_USER_KEY, updated);
    set({ user: updated });
  },

  /**
   * Replaces the cached user with the server's current copy.
   *
   * The cached one is a snapshot of whoever you were at your last LOGIN.
   * Nothing corrected it: a member promoted to MASTER_ADMIN, or granted a
   * permission, kept the old capabilities in their UI indefinitely, with
   * nothing on screen to suggest the app was out of date.
   *
   * Failures are swallowed on purpose — offline, or the backend not yet
   * redeployed with /auth/me. The cached user stays, which is exactly the
   * behaviour that existed before this, so a refresh that cannot run
   * degrades to the old state rather than signing anyone out. A genuinely
   * invalid session is handled where it always was: the API client's 401
   * refresh path.
   */
  refreshUser: async () => {
    if (get().status !== 'signedIn') return;
    try {
      const user = await authApi.getCurrentUser();
      setJSON(CACHED_USER_KEY, user);
      set({ user });
    } catch {
      // See above.
    }
  },
}));

// Wires the API client's refresh-on-401 flow into this store. This is the
// one place a circular-import-avoiding seam (see api/client.ts) gets
// connected — done once, at module load, not per-request.
setAuthHandlers({
  getAccessToken: () => useAuthStore.getState().accessToken,
  getRefreshToken: () => useAuthStore.getState().refreshToken,
  onTokensRefreshed: async (accessToken, refreshToken) => {
    await setStoredTokens(accessToken, refreshToken);
    useAuthStore.setState({ accessToken, refreshToken });
  },
  onAuthExpired: async () => {
    await useAuthStore.getState().clearSession();
  },
  onAccessRevoked: async (reason) => {
    await useAuthStore.getState().clearSession(reason);
  },
});
