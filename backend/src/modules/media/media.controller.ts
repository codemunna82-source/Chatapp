import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { ApiError } from '../../lib/ApiError';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { serveCachedAsset, IMMUTABLE_MAX_AGE_SECONDS } from '../../lib/httpAssetCache';
import { uploadMediaForTenant, getMediaBytesForTenant, getMediaPosterForTenant } from './media.service';
import { resolveMediaWidth } from './media.validation';

/** What a poster is served at when the caller does not say. One chat bubble wide on a dense screen. */
const DEFAULT_POSTER_WIDTH = 480;

export const uploadMediaHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const file = req.file;
  if (!file) {
    throw ApiError.badRequest('FILE_REQUIRED', 'A file is required (multipart field name: "file")');
  }
  const { whatsappPhoneNumberId } = req.body as { whatsappPhoneNumberId: string };

  const media = await uploadMediaForTenant({
    tenantId: auth.tenantId,
    actorUserId: auth.userId,
    whatsappPhoneNumberId,
    buffer: file.buffer,
    mimeType: file.mimetype,
    filename: file.originalname,
  });

  res.status(201).json({
    success: true,
    data: {
      id: String(media._id),
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      status: media.status,
    },
  });
});

export const getMediaHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const mediaId = req.params.id as string;

  // `?w=` asks for a bounded version of an image. A chat bubble is a few
  // hundred pixels wide and was being handed the full photo out of
  // someone's camera roll — megabytes, on a phone, on mobile data, to be
  // drawn at a fraction of its size. The resize has been available in the
  // service all along; nothing ever asked for it. No `w` still means the
  // original, which is what the full-screen viewer wants.
  const width = resolveMediaWidth(req.query.w);

  // `?poster=1` asks for a video's first frame instead of the video.
  //
  // Its own branch rather than a variant of the width parameter, because
  // it returns a DIFFERENT FILE of a different type: a JPEG derived from
  // an mp4. A client showing a video in a list wants this and never wants
  // the sixteen megabytes behind it.
  if (req.query.poster === '1') {
    const posterWidth = width ?? DEFAULT_POSTER_WIDTH;

    // Before the derivation, not after: a client that already holds this
    // frame should cost a header comparison, not a round trip to
    // Cloudinary to fetch bytes that are then thrown away.
    if (
      serveCachedAsset(req, res, {
        etag: `"poster-${mediaId}-w${posterWidth}"`,
        immutable: true,
        maxAgeSeconds: IMMUTABLE_MAX_AGE_SECONDS,
      })
    ) {
      return;
    }

    const poster = await getMediaPosterForTenant(auth.tenantId, mediaId, posterWidth);
    // No poster is an ordinary answer, not a failure: this video may
    // simply not be cached here yet. 204 says so without the client
    // having to read a body or treat it as an error.
    if (!poster) {
      // Deliberately overrides the immutable header serveCachedAsset just
      // set. "There is no poster" is a fact about right now — the same
      // video gets one as soon as it has been fetched once — and caching
      // that answer for a year would make it permanent.
      res.setHeader('Cache-Control', 'no-store');
      res.removeHeader('ETag');
      res.status(204).end();
      return;
    }
    res.setHeader('Content-Type', poster.mimeType);
    res.setHeader('Content-Length', String(poster.buffer.length));
    res.status(200).send(poster.buffer);
    return;
  }

  // The bytes behind a media id never change — WhatsApp media is written
  // once and referenced by an immutable id — so the id IS the validator,
  // and this answers before the fetch below ever runs. It used to be
  // max-age=3600 with no validator, which had every device re-downloading
  // every photo in a thread once an hour for bytes that had not moved.
  //
  // The width is part of the tag: two sizes of one photo are two
  // different responses, and sharing a tag between them would have a
  // client that already holds the thumbnail be told its full-resolution
  // request is unchanged — and show the thumbnail full-screen.
  if (
    serveCachedAsset(req, res, {
      etag: `"media-${mediaId}-w${width ?? 'full'}"`,
      immutable: true,
      maxAgeSeconds: IMMUTABLE_MAX_AGE_SECONDS,
    })
  ) {
    return;
  }

  const { buffer, mimeType } = await getMediaBytesForTenant(auth.tenantId, mediaId, width);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Length', String(buffer.length));
  res.status(200).send(buffer);
});
