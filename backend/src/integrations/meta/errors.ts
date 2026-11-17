import { ApiError } from '../../lib/ApiError';

export interface MetaErrorResponseBody {
  error?: {
    message: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

/**
 * Meta Graph API error codes worth distinguishing. Not exhaustive — anything
 * not recognized here falls back to a generic, non-retryable mapping rather
 * than guessing at Meta's intent.
 */
const RATE_LIMIT_CODES = new Set([4, 80007, 130429, 131048, 131056]);
const AUTH_ERROR_CODES = new Set([190, 200, 10]);

export class MetaApiError extends Error {
  readonly code: string;
  readonly metaCode?: number;
  readonly metaSubcode?: number;
  readonly retryable: boolean;

  constructor(message: string, opts: { code: string; metaCode?: number; metaSubcode?: number; retryable?: boolean }) {
    super(message);
    this.name = 'MetaApiError';
    this.code = opts.code;
    this.metaCode = opts.metaCode;
    this.metaSubcode = opts.metaSubcode;
    this.retryable = opts.retryable ?? false;
  }
}

/** Translates an HTTP status + Graph API error body into our typed MetaApiError. */
export function mapMetaError(status: number, body: MetaErrorResponseBody | undefined): MetaApiError {
  const metaCode = body?.error?.code;
  const message = body?.error?.message ?? `Meta API request failed with status ${status}`;

  const retryable = status >= 500 || status === 429 || (metaCode !== undefined && RATE_LIMIT_CODES.has(metaCode));

  let code = 'META_API_ERROR';
  if (status === 401 || (metaCode !== undefined && AUTH_ERROR_CODES.has(metaCode))) {
    code = 'META_AUTH_ERROR';
  } else if (retryable) {
    code = 'META_RATE_LIMITED';
  } else if (metaCode === 131047) {
    // Meta's own re-engagement/24h-window rejection — belt-and-suspenders
    // alongside our own server-side window check (spec §18).
    code = 'META_OUTSIDE_CUSTOMER_WINDOW';
  } else if (metaCode === 132000 || metaCode === 132001 || metaCode === 132005 || metaCode === 132015) {
    code = 'META_TEMPLATE_ERROR';
  } else if (status === 400) {
    code = 'META_INVALID_REQUEST';
  }

  return new MetaApiError(message, { code, metaCode, metaSubcode: body?.error?.error_subcode, retryable });
}

/** Turns a MetaApiError (or anything else) into our standard API error contract. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof MetaApiError) {
    const status = err.code === 'META_AUTH_ERROR' ? 502 : err.retryable ? 503 : 502;
    return new ApiError(status, err.code, err.message);
  }
  return ApiError.internal('META_UNKNOWN_ERROR', 'Unexpected error communicating with Meta');
}
