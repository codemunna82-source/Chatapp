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
export function resolveCorsOrigin(
  allowed: string[],
  /**
   * An extra, changeable source of trusted origins — the per-workspace
   * chat domains, which live in the database and cannot be listed in an
   * environment variable that is only read at boot.
   *
   * Consulted only after the static list misses, and expected to answer
   * from a cache: this runs on every cross-origin request, including the
   * ones an attacker sends from origins that will never match.
   */
  isAllowedOrigin?: (origin: string) => Promise<boolean>,
): CorsOptions['origin'] {
  const list = allowed.map((o) => o.trim()).filter(Boolean);
  const wildcard = list.includes('*');
  const normalized = new Set(list.map(stripTrailingSlash));

  // A wildcard still short-circuits, but only when there is no dynamic
  // source to consult — with one, "allow everything" and "allow these"
  // are the same answer and the cheaper one wins.
  if (wildcard) return true;
  if (normalized.size === 0 && !isAllowedOrigin) return false;

  return (origin, callback) => {
    // No Origin header: same-origin requests, curl, health checks and the
    // native mobile client. Not a browser cross-origin request, so there
    // is nothing for CORS to decide.
    if (!origin) return callback(null, true);

    const candidate = stripTrailingSlash(origin);
    if (normalized.has(candidate)) return callback(null, true);
    if (!isAllowedOrigin) return callback(null, false);

    isAllowedOrigin(candidate).then(
      (ok) => callback(null, ok),
      // A lookup that threw is not a grant. It is also not a 500: the
      // request continues without CORS headers, which the browser turns
      // into the same "blocked" the caller would have seen anyway.
      () => callback(null, false),
    );
  };
}

/** A trailing slash on a configured origin is a routine paste error and never meaningful. */
function stripTrailingSlash(origin: string): string {
  return origin.replace(/\/+$/, '');
}
