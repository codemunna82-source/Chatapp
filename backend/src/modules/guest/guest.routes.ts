import { Router } from 'express';
import { requireGuest } from '../../middleware/guestAuth.middleware';
import { guestRateLimiter } from '../../middleware/rateLimit.middleware';
import { validate } from '../../middleware/validate.middleware';
import { guestMessageSchema, guestMessagesQuerySchema } from './guest.validation';
import {
  getGuestSessionHandler,
  listGuestMessagesHandler,
  postGuestMessageHandler,
  markGuestReadHandler,
  getGuestIceHandler,
} from './guest.controller';

/**
 * The customer-facing web chat, mounted at /api/guest.
 *
 * Every route here is scoped to the one conversation the presented link
 * stands for — there is no route that takes a conversation id, so a
 * customer cannot ask for a different chat even by guessing an id. That is
 * a deliberate shape, not an omission.
 */
export const guestRouter = Router();

guestRouter.use(guestRateLimiter, requireGuest);

guestRouter.get('/session', getGuestSessionHandler);
guestRouter.get('/messages', validate({ query: guestMessagesQuerySchema }), listGuestMessagesHandler);
guestRouter.post('/messages', validate({ body: guestMessageSchema }), postGuestMessageHandler);
guestRouter.post('/read', markGuestReadHandler);
guestRouter.get('/ice', getGuestIceHandler);
