import type { Request, Response } from 'express';
import { serveCachedAsset, IMMUTABLE_MAX_AGE_SECONDS } from './httpAssetCache';

function fakeReq(ifNoneMatch?: string): Request {
  return { headers: ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {} } as unknown as Request;
}

function fakeRes() {
  const headers = new Map<string, string>();
  const res = {
    statusCode: 0,
    ended: false,
    setHeader: (name: string, value: string) => headers.set(name, value),
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    end() {
      res.ended = true;
    },
  };
  return { res: res as unknown as Response, headers, state: res };
}

describe('serveCachedAsset', () => {
  it('answers a matching conditional request with 304 and no body', () => {
    const { res, state } = fakeRes();
    const handled = serveCachedAsset(fakeReq('"media-abc"'), res, {
      etag: '"media-abc"',
      immutable: true,
      maxAgeSeconds: IMMUTABLE_MAX_AGE_SECONDS,
    });

    // The return value is what tells the caller to skip the expensive
    // fetch — a 304 that still downloaded the bytes would save nothing.
    expect(handled).toBe(true);
    expect(state.statusCode).toBe(304);
    expect(state.ended).toBe(true);
  });

  it('lets a request through when the validator does not match', () => {
    const { res, state } = fakeRes();
    const handled = serveCachedAsset(fakeReq('"media-stale"'), res, {
      etag: '"media-abc"',
      immutable: true,
      maxAgeSeconds: IMMUTABLE_MAX_AGE_SECONDS,
    });

    expect(handled).toBe(false);
    expect(state.statusCode).toBe(0);
  });

  it('marks a versioned URL immutable and never public', () => {
    const { res, headers } = fakeRes();
    serveCachedAsset(fakeReq(), res, {
      etag: '"user-avatar-1-2026"',
      immutable: true,
      maxAgeSeconds: IMMUTABLE_MAX_AGE_SECONDS,
    });

    expect(headers.get('ETag')).toBe('"user-avatar-1-2026"');
    expect(headers.get('Cache-Control')).toBe(`private, max-age=${IMMUTABLE_MAX_AGE_SECONDS}, immutable`);
    // Every one of these routes is tenant-scoped and behind a bearer
    // token; a shared cache must never be allowed to keep a copy.
    expect(headers.get('Cache-Control')).not.toContain('public');
  });

  it('requires revalidation when the URL carries no version', () => {
    const { res, headers } = fakeRes();
    serveCachedAsset(fakeReq(), res, {
      etag: '"user-avatar-1-current"',
      immutable: false,
      maxAgeSeconds: 300,
    });

    expect(headers.get('Cache-Control')).toBe('private, max-age=300, must-revalidate');
    expect(headers.get('Cache-Control')).not.toContain('immutable');
  });
});
