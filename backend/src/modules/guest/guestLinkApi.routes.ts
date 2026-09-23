import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate.middleware';
import { requireLinkApiKey } from '../../middleware/linkApiAuth.middleware';
import { linkApiRateLimiter } from '../../middleware/rateLimit.middleware';
import { issuePublicGuestLink } from './guest.service';

const issueLinkSchema = z.object({
  /** Whatever shape the automation holds it in — normalised server-side. */
  phone: z.string().trim().min(1).max(32),
});

/**
 * The public guest-link API, mounted at /api/public/guest-link.
 *
 * For an automation outside VOXO entirely — WhatsApp Flows, a BSP's
 * chatbot builder — that needs to hand a customer their own private-chat
 * link. Nothing else can do this on the automation's behalf: the link's
 * token is unique per customer and only VOXO's own server can mint one,
 * so a business whose invitation now goes out through Meta's own tooling
 * instead of VOXO's (see tenant settings) still needs this one call to
 * get a working link into that message rather than pasting in a single
 * static one that works for exactly one customer and then expires for
 * everyone.
 *
 * Authenticated by its own per-number key (X-VOXO-Link-Key), not a user
 * session or a guest token — see linkApiAuth.middleware.ts.
 */
export const guestLinkApiRouter = Router();

guestLinkApiRouter.post(
  '/',
  linkApiRateLimiter,
  requireLinkApiKey,
  validate({ body: issueLinkSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const phoneNumber = req.linkApiPhoneNumber!;
    const { phone } = req.body as z.infer<typeof issueLinkSchema>;
    const result = await issuePublicGuestLink(
      String(phoneNumber.tenantId),
      String(phoneNumber._id),
      phone,
    );
    res.status(200).json({ success: true, data: result });
  }),
);
