import { z } from 'zod';

/**
 * All EXPO_PUBLIC_* access in the codebase should go through this validated
 * object — never `process.env.EXPO_PUBLIC_X` directly elsewhere. These
 * values are inlined into the JS bundle at build time and ship inside the
 * APK; never put a secret here (see .env.example).
 */
const envSchema = z.object({
  EXPO_PUBLIC_API_URL: z.string().url(),
  EXPO_PUBLIC_SOCKET_URL: z.string().url(),
  /**
   * Sentry DSN. Optional, and validated only when present, so a build made
   * without one still works — crash reporting simply stays off (see
   * lib/sentry.ts). A DSN is not a secret in the way an API key is: it only
   * permits writing events, which is why it is safe in an EXPO_PUBLIC_ var
   * that ships inside the APK.
   */
  EXPO_PUBLIC_SENTRY_DSN: z.string().url().optional().or(z.literal('')),
  /** Fraction of transactions traced, 0..1. Defaults low — traces are billed per event. */
  EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
});

function loadEnv() {
  const parsed = envSchema.safeParse({
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_SOCKET_URL: process.env.EXPO_PUBLIC_SOCKET_URL,
    EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
    EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
  });

  if (!parsed.success) {
    // Thrown at module load (app startup) — a misconfigured build should
    // fail loudly, not silently point at the wrong backend.
    throw new Error(
      `Invalid VOXO mobile environment configuration: ${JSON.stringify(parsed.error.flatten().fieldErrors)}. ` +
        'Did you set EXPO_PUBLIC_API_URL / EXPO_PUBLIC_SOCKET_URL in .env? See .env.example.',
    );
  }
  return parsed.data;
}

export const env = loadEnv();

/** e.g. "http://10.0.2.2:4000/api" — the REST client's base URL. */
export const apiBaseUrl = `${env.EXPO_PUBLIC_API_URL.replace(/\/$/, '')}/api`;
export const socketUrl = env.EXPO_PUBLIC_SOCKET_URL.replace(/\/$/, '');
/** Empty string when crash reporting is not configured for this build. */
export const sentryDsn = env.EXPO_PUBLIC_SENTRY_DSN ?? '';
export const sentryTracesSampleRate = env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
