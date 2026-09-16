import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import { logger } from '../lib/logger';
import { redactQuery, redactUrl } from '../lib/redactUrl';

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const existing = req.headers['x-request-id'];
    const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // Redaction of sensitive headers/body fields is handled by the base
  // logger's `redact` config (see lib/logger.ts), applied to these too.
  //
  // The query string is the exception, and it has to be handled here: a
  // token in `req.url` is plain text inside one string, which no redact
  // PATH can reach. Meta's subscription challenge carries the verify
  // token exactly there, so every challenge was writing a credential to
  // the log in clear — one that is stored encrypted precisely so it
  // cannot be read back. See lib/redactUrl.ts.
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: redactUrl(String(req.url ?? '')),
        query: redactQuery((req.raw as { query?: unknown } | undefined)?.query),
        params: (req.raw as { params?: unknown } | undefined)?.params,
        headers: req.headers,
        remoteAddress: req.remoteAddress,
        remotePort: req.remotePort,
      };
    },
  },
});
