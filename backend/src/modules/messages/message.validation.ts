import { z } from 'zod';

const base = {
  replyToMessageId: z.string().optional(),
  /**
   * The client's own id for this send, stable across its retries.
   *
   * What it protects against is not a user tapping twice — it is the
   * send that SUCCEEDED and whose response never came back. The app's
   * outbox cannot tell that apart from a send that never arrived, so it
   * retries, and without this the retry creates a second copy of a
   * message the customer has already received.
   *
   * Optional, because older builds do not send one and refusing them
   * would break every installed app. A send without it keeps the old
   * behaviour: no protection, same as before.
   */
  clientMessageId: z.string().trim().min(1).max(128).optional(),
};

const textMessage = z.object({ type: z.literal('text'), text: z.string().trim().min(1).max(4096), ...base });
const templateMessage = z.object({
  type: z.literal('template'),
  templateName: z.string().min(1),
  languageCode: z.string().min(2),
  templateComponents: z.array(z.unknown()).optional(),
  ...base,
});
const mediaMessage = z.object({
  type: z.enum(['image', 'video', 'audio', 'document']),
  mediaId: z.string().optional(),
  mediaLink: z.string().url().optional(),
  caption: z.string().max(1024).optional(),
  filename: z.string().max(255).optional(),
  ...base,
});
// emoji: '' is valid and means "remove my previous reaction" — a real,
// documented Meta behavior, so this stays a plain string, not min(1).
const reactionMessage = z.object({
  type: z.literal('reaction'),
  reactToMessageId: z.string().min(1),
  emoji: z.string().max(8),
  clientMessageId: base.clientMessageId,
});

/**
 * A pin on a map.
 *
 * Bounded to the real ranges rather than left as plain numbers: a
 * latitude of 200 is not a place, and WhatsApp rejects it with an error
 * that says nothing useful — far better to refuse it here, where the
 * message names the field.
 */
const locationMessage = z.object({
  type: z.literal('location'),
  // Nested, matching the shape the message model stores and the service
  // reads — the controller hands the validated body straight through, so
  // a flat latitude/longitude here would arrive somewhere nothing looks.
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    name: z.string().max(120).optional(),
    address: z.string().max(240).optional(),
  }),
  ...base,
});

export const sendMessageSchema = z
  .discriminatedUnion('type', [textMessage, templateMessage, mediaMessage, reactionMessage, locationMessage])
  .refine(
    (data) => (data.type !== 'image' && data.type !== 'video' && data.type !== 'audio' && data.type !== 'document'
      ? true
      : Boolean(data.mediaId) !== Boolean(data.mediaLink)),
    { message: 'Exactly one of mediaId or mediaLink is required for a media message' },
  );

export const listMessagesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  // Capped and trimmed: this becomes a (fully escaped) regex, and an
  // unbounded pattern is a cheap way to make the database work hard.
  search: z.string().trim().min(1).max(120).optional(),
  starredOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const starMessageSchema = z.object({
  starred: z.boolean(),
});

export const conversationIdParamSchema = z.object({
  conversationId: z.string().min(1),
});

export const messageIdParamSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
});
