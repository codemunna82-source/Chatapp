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

export type MediaCategory = keyof typeof MEDIA_LIMITS;

export function categoryForMimeType(mimeType: string): MediaCategory | null {
  for (const [category, spec] of Object.entries(MEDIA_LIMITS)) {
    if (spec.mimeTypes.includes(mimeType)) return category as MediaCategory;
  }
  return null;
}

/** Throws a typed ApiError if the file doesn't match a supported type/size — never silently accepted. */
export function validateMediaFile(mimeType: string, sizeBytes: number): MediaCategory {
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
