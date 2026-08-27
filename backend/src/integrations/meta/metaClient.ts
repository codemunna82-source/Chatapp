import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { mapMetaError, MetaApiError, type MetaErrorResponseBody } from './errors';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let httpClient: AxiosInstance | null = null;

/** Lazily built so tests/mock-mode never need real credentials to import this module. */
function getHttpClient(): AxiosInstance {
  if (!httpClient) {
    httpClient = axios.create({
      baseURL: `https://graph.facebook.com/${env.META_API_VERSION}`,
      timeout: 15_000,
    });
  }
  return httpClient;
}

/**
 * Per-call auth config — deliberately NOT mutated onto the shared axios
 * instance's defaults, because that instance is reused across concurrent
 * requests for *different tenants*; baking credentials into shared mutable
 * state would let one tenant's request race another's token onto the wire.
 */
export function authConfig(accessToken: string, extra?: AxiosRequestConfig): AxiosRequestConfig {
  return {
    ...extra,
    headers: { ...extra?.headers, Authorization: `Bearer ${accessToken}` },
  };
}

/**
 * Executes one Graph API call with retry-on-transient-error (spec §14):
 * 5xx / 429 / Meta's own rate-limit codes are retried with exponential
 * backoff up to MAX_ATTEMPTS; everything else (validation, auth, template
 * errors) fails immediately — retrying those would just repeat the same
 * failure and burn Meta's rate-limit budget for nothing.
 */
export async function metaRequest<T>(build: (client: AxiosInstance) => Promise<{ data: T }>): Promise<T> {
  const client = getHttpClient();
  let lastError: MetaApiError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await build(client);
      return res.data;
    } catch (err) {
      const mapped = axios.isAxiosError(err)
        ? mapMetaError(err.response?.status ?? 0, err.response?.data as MetaErrorResponseBody | undefined)
        : new MetaApiError('Network error calling Meta API', { code: 'META_NETWORK_ERROR', retryable: true });

      lastError = mapped;
      logger.warn(
        { attempt, code: mapped.code, metaCode: mapped.metaCode, retryable: mapped.retryable },
        'Meta API request failed',
      );

      if (!mapped.retryable || attempt === MAX_ATTEMPTS) {
        throw mapped;
      }
      await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }

  throw lastError ?? new MetaApiError('Meta API request failed', { code: 'META_UNKNOWN_ERROR' });
}
