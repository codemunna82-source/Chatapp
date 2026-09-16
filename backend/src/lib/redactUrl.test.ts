import { redactUrl, redactQuery } from './redactUrl';

/**
 * The verify token used to appear in the logs in clear, on every single
 * Meta subscription challenge, despite being stored encrypted so that it
 * could not be read back. These pin the fix and, just as importantly,
 * pin what must NOT be thrown away with it.
 */
describe('redactUrl', () => {
  it('censors the verify token on Meta’s challenge, in both spellings', () => {
    const url =
      '/api/webhooks/meta/app/98b01cca2ebb06bc42?hub.mode=subscribe&hub.challenge=901594350' +
      '&hub.verify_token=s3cr3t&hub_mode=subscribe&hub_verify_token=s3cr3t';
    const out = redactUrl(url);
    expect(out).not.toContain('s3cr3t');
    expect(out).toContain('hub.verify_token=[REDACTED]');
    expect(out).toContain('hub_verify_token=[REDACTED]');
  });

  it('keeps everything a request log is actually for', () => {
    const out = redactUrl('/api/webhooks/meta/app/abc123?hub.mode=subscribe&hub.challenge=901594350&hub.verify_token=x');
    // Which app was challenged, and that it was a subscribe — none of it secret.
    expect(out).toContain('/api/webhooks/meta/app/abc123');
    expect(out).toContain('hub.mode=subscribe');
    expect(out).toContain('hub.challenge=901594350');
  });

  it('leaves a URL with no query string alone', () => {
    expect(redactUrl('/api/conversations')).toBe('/api/conversations');
    expect(redactUrl('/api/conversations?')).toBe('/api/conversations?');
  });

  it('does not re-encode the parameters it keeps', () => {
    // Round-tripping through URLSearchParams would rewrite these, and the
    // logged URL would stop matching the request that was made.
    const url = '/api/search?q=a%20b&filter=x+y&tag=%E2%9C%93';
    expect(redactUrl(url)).toBe(url);
  });

  it('censors other credentials that ride in a query string', () => {
    expect(redactUrl('/cb?code=abc&state=keep')).toBe('/cb?code=[REDACTED]&state=keep');
    expect(redactUrl('/x?access_token=abc')).toBe('/x?access_token=[REDACTED]');
    expect(redactUrl('/x?ACCESS_TOKEN=abc')).toBe('/x?ACCESS_TOKEN=[REDACTED]');
  });

  it('leaves a valueless parameter as it found it', () => {
    expect(redactUrl('/x?flag&token=abc')).toBe('/x?flag&token=[REDACTED]');
  });
});

describe('redactQuery', () => {
  it('censors the same keys in the parsed object', () => {
    expect(
      redactQuery({ 'hub.mode': 'subscribe', 'hub.verify_token': 's3cr3t', hub_verify_token: 's3cr3t' }),
    ).toEqual({ 'hub.mode': 'subscribe', 'hub.verify_token': '[REDACTED]', hub_verify_token: '[REDACTED]' });
  });

  it('passes through anything that is not a plain object', () => {
    expect(redactQuery(undefined)).toBeUndefined();
    expect(redactQuery(null)).toBeNull();
  });
});
