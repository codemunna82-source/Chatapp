import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate.middleware';
import { guestRateLimiter } from '../../middleware/rateLimit.middleware';
import { resolvePersonalGuestLink, startPersonalGuestChat } from './guest.service';

const tokenParamSchema = z.object({ token: z.string().trim().min(1).max(64) });
const startBodySchema = z.object({ phone: z.string().trim().min(1).max(32).optional() });

/**
 * The public landing page for someone's personal chat link
 * ("My personal chat link" in Settings), mounted at /api/public/personal-link.
 *
 * Unauthenticated on purpose — there is no session yet, that is the whole
 * point of this route: a stranger who has never messaged this business
 * before lands here first. Nothing it returns or accepts is sensitive
 * beyond a name (resolvePersonalGuestLink) and the phone number the
 * visitor themselves types in, which is exactly what WhatsApp's own
 * wa.me links already ask a visitor to disclose for the same reason.
 */
export const personalGuestLinkRouter = Router();

personalGuestLinkRouter.use(guestRateLimiter);

personalGuestLinkRouter.get(
  '/:token',
  validate({ params: tokenParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { token } = req.params as z.infer<typeof tokenParamSchema>;
    const owner = await resolvePersonalGuestLink(token);
    if (!owner) {
      res.status(404).json({ success: false, error: { code: 'PERSONAL_LINK_NOT_FOUND', message: 'This chat link is not working right now.' } });
      return;
    }
    res.status(200).json({ success: true, data: { displayName: owner.displayName } });
  }),
);

personalGuestLinkRouter.post(
  '/:token/start',
  validate({ params: tokenParamSchema, body: startBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { token } = req.params as z.infer<typeof tokenParamSchema>;
    const { phone } = req.body as z.infer<typeof startBodySchema>;
    const result = await startPersonalGuestChat(token, phone);
    res.status(200).json({ success: true, data: result });
  }),
);
