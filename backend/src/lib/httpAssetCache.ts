import type { Request, Response } from 'express';

export interface AssetCacheOptions {
  /** Uniquely identifies THIS version of the bytes. Compared verbatim against If-None-Match. */
  etag: string;
  /**
   * True only when the URL can never serve different bytes — an immutable
   * id, or a URL carrying a version token. Immutable responses are never
   * revalidated, so getting this wrong means a client showing a stale
   * photo for a year.
   */
  immutable: boolean;
  maxAgeSeconds: number;
}

/**
 * Sets validator and freshness headers for a binary asset and answers a
 * conditional request.
 *
 * Returns true when it has already sent a 304, in which case the caller
 * must not do the work of producing the body — which is the whole point:
 * for the media proxy that skips two round trips to Meta, and for an
 * avatar it skips a Cloudinary fetch.
 *
 * `private` throughout: every one of these routes is behind a bearer token
 * and returns one tenant's data, so a shared cache must never keep a copy.
 */
export function serveCachedAsset(req: Request, res: Response, options: AssetCacheOptions): boolean {
  res.setHeader('ETag', options.etag);
  res.setHeader(
    'Cache-Control',
    `private, max-age=${options.maxAgeSeconds}${options.immutable ? ', immutable' : ', must-revalidate'}`,
  );

  if (req.headers['if-none-match'] === options.etag) {
    res.status(304).end();
    return true;
  }
  return false;
}

/** A year — the conventional ceiling for `immutable`, and what every CDN treats as "forever". */
export const IMMUTABLE_MAX_AGE_SECONDS = 31_536_000;
