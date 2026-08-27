import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../lib/ApiError';
import { logger } from '../lib/logger';
import { env } from '../config/env';

/**
 * Single place responses are shaped into the standard
 * `{ success: false, error: { code, message } }` contract. Stack traces are
 * logged server-side only — never sent to the client, even in development,
 * to keep behavior consistent with production.
 */
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

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.flatten(),
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
