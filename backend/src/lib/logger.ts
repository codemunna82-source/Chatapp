import pino from 'pino';
import { env } from '../config/env';

/**
 * Structured logger. Redaction paths below MUST cover every field that can
 * ever hold a secret — passwords, tokens, Meta credentials. Never log these
 * in plaintext, including inside nested request bodies/headers.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'password',
      'passwordHash',
      'newPassword',
      'currentPassword',
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.currentPassword',
      'req.body.newPassword',
      'accessToken',
      'refreshToken',
      'token',
      '*.accessToken',
      '*.refreshToken',
      'META_APP_SECRET',
      'META_ACCESS_TOKEN',
      'META_VERIFY_TOKEN',
      'metaAccessToken',
    ],
    censor: '[REDACTED]',
  },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
});
