import { z } from 'zod';
import { ApiError } from '../../lib/ApiError';

/**
 * MIME types and size ceilings per Meta's published WhatsApp Cloud API
 * media specs. These are real, documented Meta limits — not invented —
 * but Meta does update them periodically, so reverify against
 * https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
 * before relying on them for a production launch.
 */
export const MEDIA_LIMITS: Record<string, { mimeTypes: string[]; maxSizeBytes: number }> = {
  image: { mimeTypes: ['image/jpeg', 'image/png'], maxSizeBytes: 5 * 1024 * 1024 },
  video: { mimeTypes: ['video/mp4', 'video/3gpp'], maxSizeBytes: 16 * 1024 * 1024 },
  audio: {
    mimeTypes: ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg'],
    maxSizeBytes: 16 * 1024 * 1024,
  },
  document: {
    mimeTypes: [
      'application/pdf',
      'application/vnd.ms-powerpoint',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
    ],
    maxSizeBytes: 100 * 1024 * 1024,
  },
};

/**
 * Image formats a phone produces that Meta will not accept.
 *
 * MEDIA_LIMITS above is Meta's list, and it stays Meta's list — it is
 * the contract with their API, not a description of what a camera roll
 * contains. Android's photo picker hands back webp constantly
 * (screenshots, anything saved from the web) and newer phones hand back
 * heic, and every one of those sends failed with "Unsupported media MIME
 * type" for a picture the person could see perfectly well on screen.
 *
 * These are accepted at upload and CONVERTED to JPEG before Meta ever
 * sees them — see uploadMediaForTenant.
 */
export const CONVERTIBLE_IMAGE_TYPES = new Set(['image/webp', 'image/heic', 'image/heif']);

/** The widest a converted image is served at, inside Meta's 5MB image ceiling. */
export const CONVERTED_IMAGE_MAX_WIDTH = 1600;

export type MediaCategory = keyof typeof MEDIA_LIMITS;

export function categoryForMimeType(mimeType: string): MediaCategory | null {
  for (const [category, spec] of Object.entries(MEDIA_LIMITS)) {
    if (spec.mimeTypes.includes(mimeType)) return category as MediaCategory;
  }
  return null;
}

/** Throws a typed ApiError if the file doesn't match a supported type/size — never silently accepted. */
export function validateMediaFile(mimeType: string, sizeBytes: number): MediaCategory {
  // A convertible image is an image, and its ceiling is the image
  // ceiling. It is checked before it is converted, which is the
  // conservative order: conversion only ever makes the file smaller.
  if (CONVERTIBLE_IMAGE_TYPES.has(mimeType)) {
    const limit = MEDIA_LIMITS.image!;
    if (sizeBytes > limit.maxSizeBytes) {
      throw ApiError.badRequest(
        'MEDIA_TOO_LARGE',
        `image files must be under ${Math.floor(limit.maxSizeBytes / (1024 * 1024))}MB`,
      );
    }
    return 'image';
  }

  const category = categoryForMimeType(mimeType);
  if (!category) {
    throw ApiError.badRequest('UNSUPPORTED_MEDIA_TYPE', `Unsupported media MIME type: ${mimeType}`);
  }
  const limit = MEDIA_LIMITS[category]!;
  if (sizeBytes > limit.maxSizeBytes) {
    throw ApiError.badRequest(
      'MEDIA_TOO_LARGE',
      `${category} files must be under ${Math.floor(limit.maxSizeBytes / (1024 * 1024))}MB`,
    );
  }
  return category;
}

export const uploadMediaBodySchema = z.object({
  whatsappPhoneNumberId: z.string().min(1),
});

/**
 * The widths the media endpoint will resize an image to.
 *
 * A fixed ladder rather than any integer the caller names. Every distinct
 * width is its own Cloudinary derivation — billed, and cached separately
 * at every layer — so an open parameter would let one photo be turned
 * into thousands of them by walking the number. Four buckets cover every
 * place the agent app draws an image: an album tile, a chat bubble, and
 * the same bubble on a 2x or 3x screen.
 *
 * The guest web chat has its own, shorter ladder on its own endpoint
 * (guest.controller.ts). Kept separate deliberately: that one is reached
 * with a link rather than a login, it is already deployed and working,
 * and a browser's needs are not a phone's.
 */
export const MEDIA_WIDTH_BUCKETS = [320, 480, 720, 1080] as const;

/**
 * Snaps a requested width up to the next bucket.
 *
 * Rounding UP, because rounding down would hand a bubble fewer pixels
 * than it draws and make every photo in the app soft. Anything beyond the
 * largest bucket is served at the largest bucket rather than at full
 * resolution: a request for 4000px is a request to undo the entire point
 * of this, and the full original is still available by asking for no
 * width at all — which is what the full-screen viewer does.
 *
 * Returns undefined for an absent or unparseable value, which means "the
 * original", exactly as before this existed.
 */
export function resolveMediaWidth(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const requested = Number(raw);
  if (!Number.isFinite(requested) || requested <= 0) return undefined;
  return MEDIA_WIDTH_BUCKETS.find((w) => requested <= w) ?? MEDIA_WIDTH_BUCKETS[MEDIA_WIDTH_BUCKETS.length - 1];
}
