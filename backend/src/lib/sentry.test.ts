import { sanitizeUrl, isReportableError } from './sentry';
import { ApiError } from './ApiError';

describe('sanitizeUrl', () => {
  it('redacts the Meta webhook verify token out of a URL', () => {
    // The one secret that genuinely travels in a query string — Meta's
    // challenge puts it there — and URLs are what Sentry records verbatim.
    const url = sanitizeUrl('/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=s3cret&hub.challenge=123');

    expect(url).not.toContain('s3cret');
    expect(url).toContain('hub.verify_token=%5Bredacted%5D');
    // Non-secret params survive, or the URL stops being useful for debugging.
    expect(url).toContain('hub.mode=subscribe');
    expect(url).toContain('hub.challenge=123');
  });

  it('redacts bearer-ish params wherever they appear', () => {
    const url = sanitizeUrl('/api/media/abc?token=xyz&access_token=pqr&v=2026');
    expect(url).not.toContain('xyz');
    expect(url).not.toContain('pqr');
    expect(url).toContain('v=2026');
  });

  it('leaves a URL with no query string untouched', () => {
    expect(sanitizeUrl('/api/conversations')).toBe('/api/conversations');
  });
});

describe('isReportableError', () => {
  it('ignores the expected 4xx outcomes this API returns by design', () => {
    // These are the API working: a closed 24-hour window, a deleted
    // contact, an expired token. Reporting them buries the real 500s.
    expect(isReportableError(new ApiError(422, 'MESSAGE_TEMPLATE_REQUIRED', 'Template required'))).toBe(false);
    expect(isReportableError(ApiError.notFound('CONTACT_NOT_FOUND'))).toBe(false);
    expect(isReportableError(ApiError.unauthorized('INVALID_TOKEN'))).toBe(false);
    expect(isReportableError(ApiError.tooManyRequests('RATE_LIMITED'))).toBe(false);
  });

  it('reports server-side failures', () => {
    expect(isReportableError(ApiError.internal('INTERNAL_ERROR'))).toBe(true);
    expect(isReportableError(new ApiError(503, 'UPSTREAM_DOWN', 'Meta unavailable'))).toBe(true);
  });

  it('reports anything with no status at all — an unexpected throw', () => {
    expect(isReportableError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(true);
    expect(isReportableError(new Error('boom'))).toBe(true);
    expect(isReportableError(null)).toBe(true);
  });
});
