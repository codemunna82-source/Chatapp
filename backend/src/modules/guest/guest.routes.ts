import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireGuest } from '../../middleware/guestAuth.middleware';
import { guestConsolePageHandler, guestConsoleScriptHandler } from './guestConsole.controller';
import { guestRateLimiter } from '../../middleware/rateLimit.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  guestBlockSchema,
  guestLocationSchema,
  guestMessageSchema,
  guestMessagesQuerySchema,
  guestReactionSchema,
  guestPushSchema,
  guestReportSchema,
} from './guest.validation';
import {
  getGuestSessionHandler,
  listGuestMessagesHandler,
  postGuestMessageHandler,
  markGuestReadHandler,
  postGuestReactionHandler,
  postGuestLocationHandler,
  postGuestReportHandler,
  setGuestBlockHandler,
  registerGuestPushHandler,
  deleteGuestPushHandler,
  getGuestIceHandler,
  uploadGuestMediaHandler,
  getGuestMediaHandler,
} from './guest.controller';
import { GUEST_MAX_FILES_PER_REQUEST, GUEST_UPLOAD_MAX_BYTES } from './guestMedia.service';

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
  // The larger of the two per-kind limits; the exact one for this file is
  // enforced in the store, which knows whether it is a photo or a recording.
  limits: { fileSize: GUEST_UPLOAD_MAX_BYTES, files: GUEST_MAX_FILES_PER_REQUEST },
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
guestRouter.post('/reactions', validate({ body: guestReactionSchema }), postGuestReactionHandler);
guestRouter.post('/location', validate({ body: guestLocationSchema }), postGuestLocationHandler);
// Reporting and blocking stay reachable from a blocked window, unlike the
// send routes: the switch that turns the block off is the one thing
// someone in that state has come here to press.
guestRouter.post('/report', validate({ body: guestReportSchema }), postGuestReportHandler);
guestRouter.post('/block', validate({ body: guestBlockSchema }), setGuestBlockHandler);
// Registering a push token is allowed from a blocked window on purpose:
// the browser refreshes its token on every load whatever the state, and
// nothing will be sent to it while the block is on. Refusing here would
// only mean a stale token the moment the customer unblocks.
guestRouter.post('/push', validate({ body: guestPushSchema }), registerGuestPushHandler);
guestRouter.delete('/push', validate({ body: guestPushSchema }), deleteGuestPushHandler);
guestRouter.post('/read', markGuestReadHandler);
guestRouter.get('/ice', getGuestIceHandler);
guestRouter.post('/media', guestUpload.array('files', GUEST_MAX_FILES_PER_REQUEST), uploadGuestMediaHandler);
guestRouter.get('/media/:id', validate({ params: mediaIdParamSchema }), getGuestMediaHandler);
