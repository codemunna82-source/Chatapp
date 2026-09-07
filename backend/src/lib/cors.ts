import type { CorsOptions } from 'cors';

/**
 * Turns the configured origin list into something the `cors` package
 * actually honours.
 *
 * Passing the raw array straight through looked right and was not: given
 * an array, `cors` compares the request's Origin against each entry as a
 * literal string, so the "*" that render.yaml ships as its default matched
 * no origin at all and blocked every browser request. Nothing surfaced it,
 * because the only client until now was the Android app — a native HTTP
 * client sends no Origin header and never goes through CORS.
 *
 * A wildcard therefore has to be handled here rather than handed to the
 * library. It reflects the requesting origin instead of literally
 * answering `*`, because the API is mounted with `credentials: true` and
 * the CORS spec forbids pairing a credentialed response with a wildcard —
 * a browser rejects that combination even though the server sent it.
 */
export function resolveCorsOrigin(allowed: string[]): CorsOptions['origin'] {
  const list = allowed.map((o) => o.trim()).filter(Boolean);
  if (list.length === 0) return false;
  if (list.includes('*')) return true;

  const normalized = new Set(list.map(stripTrailingSlash));
  return (origin, callback) => {
    // No Origin header: same-origin requests, curl, health checks and the
    // native mobile client. Not a browser cross-origin request, so there
    // is nothing for CORS to decide.
    if (!origin) return callback(null, true);
    callback(null, normalized.has(stripTrailingSlash(origin)));
  };
}

/** A trailing slash on a configured origin is a routine paste error and never meaningful. */
function stripTrailingSlash(origin: string): string {
  return origin.replace(/\/+$/, '');
}
