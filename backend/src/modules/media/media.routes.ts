import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import { z } from 'zod';
import { uploadMediaBodySchema, MEDIA_LIMITS } from './media.validation';
import { uploadMediaHandler, getMediaHandler } from './media.controller';

const mediaIdParamSchema = z.object({ id: z.string().min(1) });

// In-memory storage — files are never written to local disk (irrelevant on
// a horizontally-scaled/ephemeral deployment) and are streamed straight to
// Meta. The largest ceiling across all categories bounds multer itself;
// validateMediaFile() applies the real per-category limit afterward.
const largestLimitBytes = Math.max(...Object.values(MEDIA_LIMITS).map((l) => l.maxSizeBytes));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: largestLimitBytes } });

export const mediaRouter = Router();

mediaRouter.post(
  '/upload',
  requireAuth,
  requirePermission('CHAT_MEDIA'),
  upload.single('file'),
  validate({ body: uploadMediaBodySchema }),
  uploadMediaHandler,
);

mediaRouter.get(
  '/:id',
  requireAuth,
  requirePermission('CHAT_MEDIA'),
  validate({ params: mediaIdParamSchema }),
  getMediaHandler,
);
