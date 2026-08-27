import { mapMetaError, toApiError, MetaApiError } from './errors';

describe('mapMetaError', () => {
  it('marks a 500 response as retryable', () => {
    const err = mapMetaError(500, { error: { message: 'Internal error' } });
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('META_RATE_LIMITED');
  });

  it('marks a 429 response as retryable', () => {
    const err = mapMetaError(429, { error: { message: 'Too many requests' } });
    expect(err.retryable).toBe(true);
  });

  it('marks Meta rate-limit error codes as retryable even on a 400', () => {
    const err = mapMetaError(400, { error: { message: 'App rate limit', code: 4 } });
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('META_RATE_LIMITED');
  });

  it('marks an invalid-token error as auth, not retryable', () => {
    const err = mapMetaError(401, { error: { message: 'Invalid OAuth access token', code: 190 } });
    expect(err.code).toBe('META_AUTH_ERROR');
    expect(err.retryable).toBe(false);
  });

  it('marks a generic 400 validation error as non-retryable', () => {
    const err = mapMetaError(400, { error: { message: 'Invalid parameter', code: 100 } });
    expect(err.retryable).toBe(false);
    expect(err.code).toBe('META_INVALID_REQUEST');
  });

  it('recognizes the 24h-window rejection code', () => {
    const err = mapMetaError(400, { error: { message: 'Re-engagement message', code: 131047 } });
    expect(err.code).toBe('META_OUTSIDE_CUSTOMER_WINDOW');
  });

  it('falls back to a generic message when the body is missing', () => {
    const err = mapMetaError(502, undefined);
    expect(err.message).toContain('502');
  });
});

describe('toApiError', () => {
  it('maps a retryable MetaApiError to a 503', () => {
    const apiError = toApiError(new MetaApiError('rate limited', { code: 'META_RATE_LIMITED', retryable: true }));
    expect(apiError.statusCode).toBe(503);
    expect(apiError.code).toBe('META_RATE_LIMITED');
  });

  it('maps a non-retryable MetaApiError to a 502', () => {
    const apiError = toApiError(new MetaApiError('bad request', { code: 'META_INVALID_REQUEST', retryable: false }));
    expect(apiError.statusCode).toBe(502);
  });

  it('maps an auth MetaApiError to a 502', () => {
    const apiError = toApiError(new MetaApiError('bad token', { code: 'META_AUTH_ERROR' }));
    expect(apiError.statusCode).toBe(502);
  });

  it('falls back to a generic internal error for a non-MetaApiError', () => {
    const apiError = toApiError(new Error('something else'));
    expect(apiError.code).toBe('META_UNKNOWN_ERROR');
    expect(apiError.statusCode).toBe(500);
  });
});
