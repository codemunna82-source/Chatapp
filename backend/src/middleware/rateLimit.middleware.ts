import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

/** General API rate limiter — per-IP, tuned via env for prod vs dev. */
export const apiRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } },
});

/** Stricter limiter for auth endpoints — brute-force mitigation on login/refresh. */
export const authRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: Math.max(10, Math.floor(env.RATE_LIMIT_MAX / 5)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts, slow down.' } },
});

/**
 * Deliberately generous limiter for the Meta webhook endpoint — legitimate
 * traffic can burst (a busy tenant's status updates arrive in batches) and
 * requests are already authenticated by HMAC signature, not a per-user
 * budget, so this exists purely as a volume backstop, not the main defense.
 */
export const webhookRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX * 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many webhook requests.' } },
});
