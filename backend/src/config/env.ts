import 'dotenv/config';
import { z } from 'zod';

/**
 * All process.env access in the codebase should go through this validated,
 * typed object — never `process.env.X` directly elsewhere. Fails fast on
 * boot if required configuration is missing or malformed.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:19006')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required').optional(),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // Every META_* credential is trimmed. Values for these are pasted by hand
  // into a hosting dashboard (Render, Railway, …), and a trailing newline or
  // stray space survives that paste far more often than anyone expects — an
  // untrimmed verify token fails Meta's challenge with no visible reason,
  // and an untrimmed app secret silently breaks every HMAC check.
  META_APP_ID: z.string().optional().default('').transform((v) => v.trim()),
  META_APP_SECRET: z.string().optional().default('').transform((v) => v.trim()),
  META_VERIFY_TOKEN: z.string().optional().default('').transform((v) => v.trim()),
  META_ACCESS_TOKEN: z.string().optional().default('').transform((v) => v.trim()),
  META_BUSINESS_ACCOUNT_ID: z.string().optional().default('').transform((v) => v.trim()),
  META_PHONE_NUMBER_ID: z.string().optional().default('').transform((v) => v.trim()),
  META_API_VERSION: z.string().default('v21.0'),
  META_MOCK_MODE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  // Optional — object storage for avatars and a persistent cache of
  // WhatsApp media (which Meta's own media ids/links expire after ~30
  // days). Format: cloudinary://<api_key>:<api_secret>@<cloud_name>
  // (exactly what Cloudinary's dashboard hands you). Every feature that
  // touches this degrades gracefully when unset — see integrations/cloudinary.ts.
  CLOUDINARY_URL: z.string().optional(),

  /**
   * The full Firebase service-account JSON, pasted as one value. Enables
   * push notifications; everything degrades to socket-only delivery when
   * it is unset (see integrations/fcm/index.ts). Not trimmed the way the
   * META_* values are — this is JSON, and its own parser handles
   * surrounding whitespace.
   */
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional().default(''),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  SEED_TENANT_NAME: z.string().default('Demo Tenant'),
  SEED_MASTER_ADMIN_EMAIL: z.string().email().default('admin@example.com'),
  SEED_MASTER_ADMIN_PASSWORD: z.string().min(8).default('ChangeMe123!'),
  // seed.ts normally only creates demo WhatsApp/chat data outside production
  // (a real customer tenant shouldn't get fake contacts). Set true to opt a
  // specific production deployment into it anyway — e.g. this project's own
  // Render deployment, which is a testing environment despite NODE_ENV=production.
  SEED_DEMO_DATA: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration — see errors above.');
  }
  return parsed.data;
}

export const env = loadEnv();
