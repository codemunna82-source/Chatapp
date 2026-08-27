import { create } from 'zustand';
import { getStoredTokens, setStoredTokens, clearStoredTokens } from '../storage/secureStorage';
import { getJSON, setJSON, remove as removeCached } from '../storage/mmkv';
import { setAuthHandlers } from '../api/client';
import { ALL_PERMISSIONS, type AuthTokens, type AuthUser } from '../api/types';

const CACHED_USER_KEY = 'voxo.cachedUser';

export type AuthStatus = 'hydrating' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  /**
   * True only for the "Continue without login" testing bypass (see
   * LoginScreen) — a real signed-in session never sets this. Every screen
   * still calls the real backend and will show real network errors with no
   * backend reachable; this only exists to look at the app's UI/navigation
   * without a live server. Never persisted, so a restart returns to the
   * real login screen.
   */
  demoMode: boolean;
  /** Reads persisted tokens/user at app startup — call once from the root component. */
  hydrate: () => Promise<void>;
  setSession: (tokens: AuthTokens) => Promise<void>;
  clearSession: () => Promise<void>;
  /** Testing-only bypass — see `demoMode` above. Never persisted. */
  enterDemoMode: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'hydrating',
  accessToken: null,
  refreshToken: null,
  user: null,
  demoMode: false,

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
    set({ status: 'signedOut', accessToken: null, refreshToken: null, user: null, demoMode: false });
  },

  enterDemoMode: () => {
    // Deliberately NOT persisted (no setStoredTokens/setJSON call) — this
    // never touches the real session storage, so it can't be mistaken for
    // a real login on the next app launch, and clearSession()'s "partial
    // state = signed out" hydrate logic never sees it.
    set({
      status: 'signedIn',
      demoMode: true,
      accessToken: 'demo-mode-no-backend',
      refreshToken: 'demo-mode-no-backend',
      user: {
        id: 'demo-user',
        tenantId: 'demo-tenant',
        email: 'demo@voxo.local',
        role: 'MASTER_ADMIN',
        permissions: [...ALL_PERMISSIONS],
        displayName: 'Demo User',
      },
    });
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
