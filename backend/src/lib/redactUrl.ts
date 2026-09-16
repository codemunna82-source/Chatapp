/**
 * Strips secret-bearing query values out of a URL before it is logged.
 *
 * Needed because redaction by path cannot reach them. The request logger
 * records `req.url` as one string, so a token in the query string is
 * plain text inside it however many paths lib/logger.ts lists — and
 * Meta's subscription challenge puts the verify token exactly there:
 *
 *   /api/webhooks/meta/app/<ref>?hub.mode=subscribe&hub.verify_token=<secret>
 *
 * That token is stored encrypted precisely so it cannot be read back, and
 * then every challenge wrote it to the log in clear, where log shipping,
 * a support screenshot or a dashboard session exposes it. Meta sends it
 * on every re-verification, so this was not a one-off.
 *
 * The path and the harmless parameters are kept: knowing WHICH app was
 * challenged and whether the mode was `subscribe` is most of the value of
 * the log line, and none of it is secret.
 */

/**
 * Query keys whose values never belong in a log.
 *
 * Matched case-insensitively, and on both spellings Meta sends — it
 * includes `hub.verify_token` and `hub_verify_token` in the same URL.
 */
const SECRET_QUERY_KEYS = [
  'hub.verify_token',
  'hub_verify_token',
  'access_token',
  'accesstoken',
  'token',
  'code',
  'client_secret',
  'appsecret_proof',
  'password',
];

const CENSOR = '[REDACTED]';

export function redactUrl(url: string): string {
  const split = url.indexOf('?');
  if (split < 0) return url;

  const path = url.slice(0, split);
  const query = url.slice(split + 1);
  if (!query) return url;

  // Hand-parsed rather than via URLSearchParams, because round-tripping
  // through that re-encodes every other parameter and the logged URL
  // stops matching what was actually requested — which is the one thing
  // a request log is for.
  const redacted = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      const key = pair.slice(0, eq);
      return SECRET_QUERY_KEYS.includes(key.toLowerCase()) ? `${key}=${CENSOR}` : pair;
    })
    .join('&');

  return `${path}?${redacted}`;
}

/** The same rule for an already-parsed query object. */
export function redactQuery(query: unknown): unknown {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return query;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    out[key] = SECRET_QUERY_KEYS.includes(key.toLowerCase()) ? CENSOR : value;
  }
  return out;
}
