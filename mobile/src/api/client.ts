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
  /**
   * Called when the server refuses this account outright, with the reason
   * to show. Distinct from onAuthExpired: no refresh could help, and the
   * user needs to be told WHY rather than dropped at a login screen that
   * looks like they were merely logged out.
   */
  onAccessRevoked: (reason: string) => Promise<void>;
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

/**
 * How long an upload is given, instead of the 15s every other call gets.
 *
 * The default applied to uploads too, which is where it did real damage: a
 * couple of megabytes of photo on mobile data does not finish in fifteen
 * seconds, so axios aborted the request mid-body. The server logged
 * "Request aborted" from multer and the user was told the upload failed —
 * for a photo that was uploading perfectly well and would have arrived.
 *
 * Two minutes is not a guess at how long an upload takes; it is long
 * enough that hitting it means something is genuinely wrong rather than
 * merely slow.
 */
export const UPLOAD_TIMEOUT_MS = 120_000;

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

export async function refreshAccessToken(): Promise<string | null> {
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
    if (
      status === 401 &&
      code !== 'RATE_LIMITED' &&
      // Refreshing cannot fix a replaced session — the refresh is refused
      // for the same reason — and trying turns a clear answer into a
      // silent one.
      code !== 'SESSION_REPLACED' &&
      !isAuthEndpoint &&
      original &&
      !original._retried
    ) {
      original._retried = true;
      const newAccessToken = await refreshAccessToken();
      if (newAccessToken) {
        original.headers.set('Authorization', `Bearer ${newAccessToken}`);
        return apiClient(original);
      }
    }

    /**
     * The admin switched this number's access off (or the account itself).
     *
     * No refresh can fix a 403 — the token is fine, the answer is no — so
     * retrying or leaving the user on a screen full of failed requests
     * tells them nothing. The session is ended and the reason carried to
     * the sign-in screen, where it is the only thing on it.
     */
    if (status === 403 && code === 'NUMBER_ACCESS_DENIED') {
      const reason =
        error.response?.data?.error?.message ??
        'Your access has been turned off. Please contact your administrator.';
      await authHandlers?.onAccessRevoked(reason);
    }

    /**
     * The account was signed in on another device, and accounts are one
     * device at a time.
     *
     * Handled before the refresh branch above can even be reached on a
     * 401, because refreshing is exactly what must NOT happen: the
     * refresh would be refused for the same reason, and retrying it just
     * turns a clear answer into a silent failure. The reason is carried
     * to the sign-in screen instead, so the person learns what happened
     * rather than finding themselves logged out for no stated cause.
     */
    if (status === 401 && code === 'SESSION_REPLACED') {
      const reason =
        error.response?.data?.error?.message ??
        'Your account was signed in on another device. Sign in again to use it here.';
      await authHandlers?.onAccessRevoked(reason);
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

/**
 * True when a request never reached the server — no connection, DNS
 * failure, or a timeout with nothing returned.
 *
 * The distinction matters for the offline outbox: a request that failed
 * this way can be safely retried later, while one the server actually
 * answered with a 4xx (bad template, closed 24-hour window, revoked
 * permission) would fail identically forever and must not be queued.
 *
 * A 5xx is deliberately NOT offline: the server received the send, and
 * re-sending could deliver the same message twice.
 */
export function isOfflineError(err: unknown): boolean {
  // eslint-disable-next-line import/no-named-as-default-member
  if (!axios.isAxiosError(err)) return false;
  if (err.response) return false;
  return err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED' || err.message === 'Network Error';
}
