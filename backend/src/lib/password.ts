import argon2 from 'argon2';

/**
 * Argon2id — the OWASP-recommended variant (resistant to both GPU and
 * side-channel attacks), used for all password storage.
 */
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Malformed/foreign hash — treat as a failed verification, not a crash.
    return false;
  }
}
