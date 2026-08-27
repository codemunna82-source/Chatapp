import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { apiBaseUrl } from '../utils/env';
import type { ApiFailure } from './types';

/**
 * The API client never imports the Zustand auth store directly — that
 * would create a circular dependency (the store needs to call the API to
 * log in). Instead, authStore.ts calls setAuthHandlers() once at startup to
 * wire itself in. Keep this the ONLY inversion-of-control seam in the API
 * layer; don't add more ad hoc global state here.
 */
export interface AuthHandlers {
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  /** Called after a successful silent refresh — must persist the new pair. */
  onTokensRefreshed: (accessToken: string, refreshToken: string) => Promise<void>;
  /** Called when refresh itself fails (refresh token invalid/expired/reused) — must clear the session. */
  onAuthExpired: () => Promise<void>;
}

let authHandlers: AuthHandlers | null = null;

export function setAuthHandlers(handlers: AuthHandlers): void {
  authHandlers = handlers;
}

// eslint-disable-next-line import/no-named-as-default-member
export const apiClient: AxiosInstance = axios.create({
  baseURL: apiBaseUrl,
  timeout: 15_000,
});

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = authHandlers?.getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

// Refresh-on-401 with a single in-flight refresh shared across concurrent
// requests — without this, N requests failing at once with an expired token
// would each independently hit POST /auth/refresh, and since the backend
// rotates the refresh token on every use (backend/src/modules/auth/auth.service.ts),
// only the first would succeed; the rest would look like token-reuse/theft
// and could tear down the whole session.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!authHandlers) return null;
  const refreshToken = authHandlers.getRefreshToken();
  if (!refreshToken) return null;

  if (!refreshPromise) {
    type RefreshResponse = { success: true; data: { accessToken: string; refreshToken: string } };
    refreshPromise = axios
      .post<RefreshResponse>(`${apiBaseUrl}/auth/refresh`, { refreshToken })
      .then(async (res: AxiosResponse<RefreshResponse>) => {
        const { accessToken, refreshToken: newRefreshToken } = res.data.data;
        await authHandlers?.onTokensRefreshed(accessToken, newRefreshToken);
        return accessToken;
      })
      .catch(async () => {
        await authHandlers?.onAuthExpired();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiFailure>) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const status = error.response?.status;
    const code = error.response?.data?.error?.code;

    // Never attempt a refresh-and-retry loop on the refresh call itself, or
    // more than once per original request.
    const isAuthEndpoint = original?.url?.includes('/auth/');
    if (status === 401 && code !== 'RATE_LIMITED' && !isAuthEndpoint && original && !original._retried) {
      original._retried = true;
      const newAccessToken = await refreshAccessToken();
      if (newAccessToken) {
        original.headers.set('Authorization', `Bearer ${newAccessToken}`);
        return apiClient(original);
      }
    }

    return Promise.reject(error);
  },
);

/** Extracts a human-readable message from any error this client can throw — for toasts/inline errors. */
export function getApiErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  // axios's CJS/ESM interop makes isAxiosError look like a named export to
  // this resolver; TS only sees it as a member of the default export.
  // eslint-disable-next-line import/no-named-as-default-member
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as ApiFailure | undefined;
    if (data?.error?.message) return data.error.message;
    if (err.message === 'Network Error') return 'No connection — check your internet and try again.';
  }
  return fallback;
}

export function getApiErrorCode(err: unknown): string | undefined {
  // axios's CJS/ESM interop makes isAxiosError look like a named export to
  // this resolver; TS only sees it as a member of the default export.
  // eslint-disable-next-line import/no-named-as-default-member
  if (axios.isAxiosError(err)) {
    return (err.response?.data as ApiFailure | undefined)?.error?.code;
  }
  return undefined;
}
