import { z, ZodError } from 'zod';
import type { Request, Response } from 'express';
import { errorHandler } from './errorHandler.middleware';
import { ApiError } from '../lib/ApiError';
import { EncryptionKeyError } from '../lib/crypto';

function run(err: unknown) {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  errorHandler(err, { path: '/api/test' } as Request, res as unknown as Response, () => {});
  return res as { statusCode: number; body: { error: { code: string; message: string; details?: unknown } } };
}

/**
 * What a client is actually told when a request is refused.
 *
 * Pinned because every one of these was, at some point, a generic
 * sentence that sent someone hunting: a validation failure that named no
 * field, and a misconfigured encryption key that surfaced as "Something
 * went wrong. Please try again."
 */
describe('errorHandler', () => {
  it('reports the schema’s own message, not "Request validation failed"', () => {
    const schema = z.object({
      appSecret: z
        .string()
        .regex(/^[0-9a-f]{32}$/, 'That is not a Meta app secret — it should be 32 characters, 0-9 and a-f'),
    });
    // The exact production case: an access token pasted into the app
    // secret box. The old message said only that something was wrong.
    const err = schema.safeParse({ appSecret: 'EAAY8vu3bvZCcBST8' }).error as ZodError;

    const res = run(err);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('That is not a Meta app secret');
    expect(res.body.error.message).toContain('appSecret');
  });

  it('names the field when the message alone would not locate it', () => {
    const err = z.object({ name: z.string() }).safeParse({}).error as ZodError;
    // "Required" on a form with eight inputs is not an answer by itself.
    expect(run(err).body.error.message).toMatch(/^name: /);
  });

  it('still sends the whole flattened error, so a client can mark the field', () => {
    const err = z.object({ name: z.string() }).safeParse({}).error as ZodError;
    expect(run(err).body.error.details).toMatchObject({ fieldErrors: { name: expect.any(Array) } });
  });

  it('answers a misconfigured encryption key as a 503 that says what to fix', () => {
    const res = run(new EncryptionKeyError('ENCRYPTION_KEY must decode to 32 bytes, got 12.'));
    expect(res.statusCode).toBe(503);
    expect(res.body.error.code).toBe('ENCRYPTION_KEY_INVALID');
    expect(res.body.error.message).toContain('ENCRYPTION_KEY');
  });

  it('passes an ApiError through with its own code and status', () => {
    const res = run(ApiError.conflict('META_APP_EXISTS', 'This Meta app is already added.'));
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'META_APP_EXISTS' });
  });

  it('keeps an unknown error generic', () => {
    // The MESSAGE never carries the internal error, in any environment.
    // `details` does, outside production only — a deliberate development
    // aid, and the reason this asserts the message rather than the whole
    // body. Render runs NODE_ENV=production, so nothing leaks there.
    const res = run(new Error('mongo connection string is postgres://user:hunter2@host'));
    expect(res.statusCode).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).toBe('Something went wrong. Please try again.');
  });
});
