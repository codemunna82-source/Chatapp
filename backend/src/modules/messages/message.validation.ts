import { z } from 'zod';

const base = {
  replyToMessageId: z.string().optional(),
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
});

export const sendMessageSchema = z
  .discriminatedUnion('type', [textMessage, templateMessage, mediaMessage, reactionMessage])
  .refine(
    (data) => (data.type !== 'image' && data.type !== 'video' && data.type !== 'audio' && data.type !== 'document'
      ? true
      : Boolean(data.mediaId) !== Boolean(data.mediaLink)),
    { message: 'Exactly one of mediaId or mediaLink is required for a media message' },
  );

export const listMessagesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const conversationIdParamSchema = z.object({
  conversationId: z.string().min(1),
});
