import * as Sentry from '@sentry/node';
import { env } from '../config/env';

/**
 * Whether error reporting is switched on at all.
 *
 * Everything here is a no-op without a DSN, so a local checkout, the test
 * suite and any self-hosted deployment run with no Sentry account and no
 * network calls out.
 */
export function isSentryEnabled(): boolean {
  return env.SENTRY_DSN.length > 0;
}

/**
 * Query-string keys whose values must never leave the process.
 *
 * `hub.verify_token` is Meta's webhook challenge secret and appears in a
 * URL, which is the one place Sentry records verbatim by default.
 */
const REDACTED_QUERY_KEYS = new Set(['token', 'access_token', 'hub.verify_token', 'signature']);

/**
 * Strips secrets and personal data out of a URL before it is recorded.
 *
 * This is a WhatsApp inbox: the things flowing through these routes are
 * customers' phone numbers and the text of their messages. None of it is
 * needed to debug a stack trace, and all of it would be a data-protection
 * problem sitting in a third-party dashboard.
 */
export function sanitizeUrl(raw: string): string {
  const [path, queryString] = raw.split('?');
  if (!queryString) return raw;

  const params = new URLSearchParams(queryString);
  for (const key of params.keys()) {
    if (REDACTED_QUERY_KEYS.has(key)) params.set(key, '[redacted]');
  }
  const rebuilt = params.toString();
  return rebuilt ? `${path}?${rebuilt}` : (path as string);
}

/**
 * Starts error reporting.
 *
 * Must run before Express, Mongoose and the HTTP client are imported —
 * Sentry patches those modules at require time, so anything already loaded
 * is never instrumented. That is why server.ts imports ./instrument on its
 * very first line rather than calling this from main().
 */
export function initSentry(): void {
  if (!isSentryEnabled()) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    // Render exposes the deployed commit; anything else sets SENTRY_RELEASE
    // itself. Without one, "which release introduced this" is unanswerable.
    release: env.SENTRY_RELEASE || process.env.RENDER_GIT_COMMIT || undefined,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,

    // Left off deliberately, and it is the single most important setting
    // here. Turning it on attaches request bodies, headers and IP
    // addresses — which on this API means the full text of customers'
    // messages, their phone numbers, and bearer tokens.
    sendDefaultPii: false,

    beforeSend(event) {
      if (event.request?.url) event.request.url = sanitizeUrl(event.request.url);
      // Belt and braces: nothing should attach these with sendDefaultPii
      // off, but a future integration enabling one of them should not
      // silently start shipping message text.
      delete event.request?.data;
      delete event.request?.cookies;
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.Authorization;
        delete event.request.headers['x-hub-signature-256'];
      }
      return event;
    },

    beforeBreadcrumb(breadcrumb) {
      if (typeof breadcrumb.data?.url === 'string') {
        breadcrumb.data.url = sanitizeUrl(breadcrumb.data.url);
      }
      return breadcrumb;
    },
  });
}

/**
 * True for the errors worth alerting on.
 *
 * An ApiError below 500 is the API working correctly: a closed 24-hour
 * window, a contact that does not exist, a token that expired. Reporting
 * those would bury the real failures under thousands of events that need
 * no action — which is how a Sentry project stops being read.
 */
export function isReportableError(err: unknown): boolean {
  const status = (err as { statusCode?: number; status?: number } | null)?.statusCode
    ?? (err as { status?: number } | null)?.status;
  if (typeof status === 'number') return status >= 500;
  return true;
}

/**
 * Reports an error raised outside the Express request cycle — a queue
 * worker, a socket handler, a scheduled sweep. Those have no error
 * middleware to fall through to, so without this they are logged and
 * forgotten.
 */
export function captureBackgroundError(err: unknown, context: Record<string, unknown> = {}): void {
  if (!isSentryEnabled()) return;
  Sentry.captureException(err, { extra: context });
}

export { Sentry };
