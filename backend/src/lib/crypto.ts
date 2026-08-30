import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/**
 * Authenticated encryption for credentials held at rest.
 *
 * Used for Meta access tokens, which are the highest-value secret this
 * system holds: one of them lets the bearer send WhatsApp messages as
 * somebody's business until it is revoked. A database dump, a backup left
 * on a laptop, or a read-only Atlas user is enough to leak every tenant's
 * token if they are stored as plaintext.
 *
 * AES-256-GCM rather than AES-CBC: GCM authenticates as well as encrypts,
 * so a tampered ciphertext fails loudly on decrypt instead of yielding
 * plausible-looking garbage that then gets sent to Meta as a bearer token.
 */

const ALGORITHM = 'aes-256-gcm';
/** 96 bits — the size GCM is specified around, and the only one where its nonce-misuse bounds hold. */
const IV_BYTES = 12;
const KEY_BYTES = 32;
const AUTH_TAG_BYTES = 16;

/**
 * Prefix on every envelope so the format can change without guessing.
 *
 * A future key rotation writes `v2:` and keeps reading `v1:`; without a
 * version marker that migration has no way to tell the two apart.
 */
const ENVELOPE_VERSION = 'v1';

let cachedKey: Buffer | null = null;

/**
 * Parses ENCRYPTION_KEY into 32 raw bytes.
 *
 * Accepts base64 or hex because those are what a key generator hands you
 * (`openssl rand -base64 32` / `-hex 32`), and getting told "that is 31
 * bytes" at boot is far better than at the first decrypt in production.
 */
function loadKey(): Buffer {
  if (cachedKey) return cachedKey;

  // Read live from process.env, falling back to the value validated at
  // boot. `env` is parsed once at import, so going through it alone would
  // freeze the key for the lifetime of the process — which makes rotation
  // impossible without a restart, and makes this module untestable. The
  // length check below applies whichever source wins, so nothing is
  // trusted just because it arrived late.
  const raw = process.env.ENCRYPTION_KEY?.trim() || env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY is not set — required to store Meta access tokens. Generate one with: openssl rand -base64 32',
    );
  }

  // Try hex first: a 64-char hex string is also valid base64, and
  // interpreting it as base64 would silently produce the wrong 48 bytes.
  const looksHex = /^[0-9a-fA-F]{64}$/.test(raw);
  const key = looksHex ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. Generate one with: openssl rand -base64 32`,
    );
  }

  cachedKey = key;
  return key;
}

/** Clears the cached key. For tests, which set ENCRYPTION_KEY per case. */
export function resetEncryptionKeyCache(): void {
  cachedKey = null;
}

/**
 * Encrypts a secret into a single self-describing string:
 * `v1:<iv>:<authTag>:<ciphertext>`, each part base64url.
 *
 * One string rather than three columns on purpose — the three parts are
 * meaningless apart, and keeping them together makes it impossible to
 * write a document with a ciphertext and a mismatched IV.
 */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    ENVELOPE_VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

/**
 * Reverses encryptSecret.
 *
 * Throws on a malformed envelope, an unknown version, or a failed
 * authentication tag. Callers must NOT catch this and fall back to
 * anything: a token that fails to decrypt is a token we do not have, and
 * proceeding with a partial or corrupted value would mean calling Meta
 * with garbage credentials.
 */
export function decryptSecret(envelope: string): string {
  const key = loadKey();
  const parts = envelope.split(':');
  if (parts.length !== 4) {
    throw new Error('Malformed encrypted value — expected 4 colon-separated parts');
  }

  const [version, ivPart, tagPart, ciphertextPart] = parts as [string, string, string, string];
  if (version !== ENVELOPE_VERSION) {
    throw new Error(`Unsupported encrypted value version '${version}'`);
  }

  const iv = Buffer.from(ivPart, 'base64url');
  const authTag = Buffer.from(tagPart, 'base64url');
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new Error('Malformed encrypted value — bad IV or auth tag length');
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Whether a stored value is one of our envelopes.
 *
 * The WhatsApp account collection holds a mix during the migration: rows
 * written before encryption existed still carry a plaintext token in
 * `accessTokenRef`. This is how the read path tells them apart without
 * attempting a decrypt that would throw on legacy data.
 */
export function isEncryptedEnvelope(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${ENVELOPE_VERSION}:`) && value.split(':').length === 4;
}

/**
 * Constant-time string comparison, for secrets compared by value.
 *
 * `===` on a secret leaks its prefix through timing. Lengths are compared
 * first and non-secretly, which is unavoidable and not sensitive here.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
