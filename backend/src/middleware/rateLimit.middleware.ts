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

/**
 * The customer-facing web chat. Public in a way the rest of the API is
 * not — the link is in a WhatsApp thread that can be forwarded to anyone —
 * so this is per-IP and tighter than the general budget, while still
 * leaving room for someone typing quickly on a page that also polls.
 */
export const guestRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: Math.max(30, Math.floor(env.RATE_LIMIT_MAX / 2)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } },
});

/**
 * The public guest-link API (guestLinkApi.routes.ts). Keyed by the
 * presented key rather than by IP: a BSP or WhatsApp Flows calls from
 * infrastructure it shares with every other business on the platform, so
 * an IP-keyed limit would throttle this number's automation because of
 * traffic from someone else's. A missing/malformed key falls back to the
 * IP — there is nothing else to key on before the key itself is even
 * read, and that request is rejected by requireLinkApiKey immediately
 * after anyway.
 */
export const linkApiRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: Math.max(60, env.RATE_LIMIT_MAX),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const key = req.headers['x-voxo-link-key'];
    return typeof key === 'string' && key ? key : (req.ip ?? 'unknown');
  },
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } },
});
