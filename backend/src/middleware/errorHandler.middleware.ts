import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../lib/ApiError';
import { EncryptionKeyError } from '../lib/crypto';
import { logger } from '../lib/logger';
import { env } from '../config/env';

/**
 * Single place responses are shaped into the standard
 * `{ success: false, error: { code, message } }` contract. Stack traces are
 * logged server-side only — never sent to the client, even in development,
 * to keep behavior consistent with production.
 */
/**
 * The most useful single line out of a Zod failure.
 *
 * The field name is included because a schema message is not always
 * self-locating: "Required" and "Expected string" say nothing on a form
 * with eight inputs. Where the message already names the problem, the
 * prefix is a small cost against the case where it is the only clue.
 */
function firstFieldMessage(flat: {
  formErrors: string[];
  fieldErrors: Record<string, string[] | undefined>;
}): string | null {
  for (const [field, messages] of Object.entries(flat.fieldErrors)) {
    const message = messages?.[0];
    if (message) return `${field}: ${message}`;
  }
  return flat.formErrors[0] ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    if (err.statusCode >= 500) {
      logger.error({ err, path: req.path }, 'Unhandled ApiError');
    }
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
    return;
  }

  /**
   * A server misconfiguration, answered as one.
   *
   * Every route that stores a credential encrypts it, so a bad
   * ENCRYPTION_KEY surfaced as a generic 500 on whichever of them an
   * admin reached first — with the real cause only in the logs and the
   * client showing "Something went wrong. Please try again." Mapped here
   * rather than in each route because it is one fault with one fix, and
   * the next feature to store a secret would otherwise reintroduce it.
   *
   * The message names the variable and how to generate a valid value. It
   * cannot leak the key: getting here means the key could not be parsed.
   */
  if (err instanceof EncryptionKeyError) {
    logger.error({ err, path: req.path }, 'Encryption key is misconfigured');
    res.status(503).json({
      success: false,
      error: { code: 'ENCRYPTION_KEY_INVALID', message: err.message },
    });
    return;
  }

  if (err instanceof ZodError) {
    const flat = err.flatten();
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        // The first field error, not "Request validation failed".
        //
        // The schemas already carry messages written for a person to read
        // — "That is not a Meta app secret — it should be 32 characters,
        // 0-9 and a-f" — and every one of them was being thrown into
        // `details` and replaced with a sentence that says nothing. A
        // client showing the message (which is all most of them do) told
        // the user only that something was wrong, on a form where the
        // actual fault was a value pasted into the wrong box.
        message: firstFieldMessage(flat) ?? 'Request validation failed',
        // Still sent whole, so a client that can mark the offending field
        // has what it needs.
        details: flat,
      },
    });
    return;
  }

  logger.error({ err, path: req.path }, 'Unexpected error');
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
      ...(env.NODE_ENV !== 'production' && err instanceof Error ? { details: err.message } : {}),
    },
  });
}
