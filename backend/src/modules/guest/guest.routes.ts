import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireGuest } from '../../middleware/guestAuth.middleware';
import { guestConsolePageHandler, guestConsoleScriptHandler } from './guestConsole.controller';
import { guestRateLimiter } from '../../middleware/rateLimit.middleware';
import { validate } from '../../middleware/validate.middleware';
import { guestMessageSchema, guestMessagesQuerySchema } from './guest.validation';
import {
  getGuestSessionHandler,
  listGuestMessagesHandler,
  postGuestMessageHandler,
  markGuestReadHandler,
  getGuestIceHandler,
  uploadGuestMediaHandler,
  getGuestMediaHandler,
} from './guest.controller';
import { GUEST_IMAGE_MAX_BYTES, GUEST_MAX_FILES_PER_REQUEST } from './guestMedia.service';

/**
 * The customer-facing web chat, mounted at /api/guest.
 *
 * Every route here is scoped to the one conversation the presented link
 * stands for — there is no route that takes a conversation id, so a
 * customer cannot ask for a different chat even by guessing an id. That is
 * a deliberate shape, not an omission.
 */
// In memory, never local disk: the bytes go straight to Cloudinary or the
// database, and a deployment can be replaced between two requests.
const guestUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: GUEST_IMAGE_MAX_BYTES, files: GUEST_MAX_FILES_PER_REQUEST },
});

const mediaIdParamSchema = z.object({ id: z.string().min(1) });

export const guestRouter = Router();

// Registered before the guest auth middleware, and that order is the
// point: this page holds no link token — it is the thing that produces
// one. It signs in through the ordinary /api/auth/login like any other
// client, so it is not a way past authentication.
guestRouter.get('/console', guestRateLimiter, guestConsolePageHandler);
guestRouter.get('/console.js', guestRateLimiter, guestConsoleScriptHandler);

guestRouter.use(guestRateLimiter, requireGuest);

guestRouter.get('/session', getGuestSessionHandler);
guestRouter.get('/messages', validate({ query: guestMessagesQuerySchema }), listGuestMessagesHandler);
guestRouter.post('/messages', validate({ body: guestMessageSchema }), postGuestMessageHandler);
guestRouter.post('/read', markGuestReadHandler);
guestRouter.get('/ice', getGuestIceHandler);
guestRouter.post('/media', guestUpload.array('files', GUEST_MAX_FILES_PER_REQUEST), uploadGuestMediaHandler);
guestRouter.get('/media/:id', validate({ params: mediaIdParamSchema }), getGuestMediaHandler);
