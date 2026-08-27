import { create } from 'zustand';
import { getStoredTokens, setStoredTokens, clearStoredTokens } from '../storage/secureStorage';
import { getJSON, setJSON, remove as removeCached } from '../storage/mmkv';
import { setAuthHandlers } from '../api/client';
import type { AuthTokens, AuthUser } from '../api/types';

const CACHED_USER_KEY = 'voxo.cachedUser';

export type AuthStatus = 'hydrating' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  /** Reads persisted tokens/user at app startup — call once from the root component. */
  hydrate: () => Promise<void>;
  setSession: (tokens: AuthTokens) => Promise<void>;
  clearSession: () => Promise<void>;
  /** Merges a partial update into the cached user (e.g. avatarUpdatedAt after an upload) without a full re-login. */
  updateUser: (patch: Partial<AuthUser>) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'hydrating',
  accessToken: null,
  refreshToken: null,
  user: null,

  hydrate: async () => {
    const { accessToken, refreshToken } = await getStoredTokens();
    const user = getJSON<AuthUser>(CACHED_USER_KEY);

    if (accessToken && refreshToken && user) {
      set({ status: 'signedIn', accessToken, refreshToken, user });
    } else {
      // Partial/corrupt state (e.g. tokens without a cached user) is
      // treated as signed out — never guess at a session.
      await clearStoredTokens();
      removeCached(CACHED_USER_KEY);
      set({ status: 'signedOut', accessToken: null, refreshToken: null, user: null });
    }
  },

  setSession: async (tokens: AuthTokens) => {
    await setStoredTokens(tokens.accessToken, tokens.refreshToken);
    setJSON(CACHED_USER_KEY, tokens.user);
    set({
      status: 'signedIn',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: tokens.user,
    });
  },

  clearSession: async () => {
    await clearStoredTokens();
    removeCached(CACHED_USER_KEY);
    set({ status: 'signedOut', accessToken: null, refreshToken: null, user: null });
  },

  updateUser: (patch: Partial<AuthUser>) => {
    const current = get().user;
    if (!current) return;
    const updated = { ...current, ...patch };
    setJSON(CACHED_USER_KEY, updated);
    set({ user: updated });
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
});
