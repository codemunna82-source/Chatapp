import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { ApiError } from '../../lib/ApiError';
import { env } from '../../config/env';
import { Tenant, DEFAULT_AUTO_GUEST_LINK_MESSAGE } from './tenant.model';

/**
 * Workspace-wide settings. MASTER_ADMIN only — these change what every
 * customer of the workspace experiences, which is not a member's call.
 */
export const tenantRouter = Router();

tenantRouter.use(requireAuth, requireRole('MASTER_ADMIN'));

const autoGuestLinkSchema = z.object({
  enabled: z.boolean(),
  // Bounded to leave room under WhatsApp's own text limit once the URL is
  // substituted in — a message that Meta rejects at send time would fail
  // silently inside the webhook handler, where nobody is watching.
  message: z.string().trim().min(1).max(900).optional(),
});

tenantRouter.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const auth = getTenantContext(req);
    const tenant = await Tenant.findById(auth.tenantId).select('name autoGuestLink').lean();
    if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Workspace not found');

    res.status(200).json({
      success: true,
      data: {
        name: tenant.name,
        autoGuestLink: {
          enabled: tenant.autoGuestLink?.enabled ?? false,
          message: tenant.autoGuestLink?.message ?? DEFAULT_AUTO_GUEST_LINK_MESSAGE,
        },
        // Without this the feature cannot work at all, and the admin has no
        // way to find that out short of turning it on and waiting for a
        // customer to receive nothing.
        guestLinkConfigured: env.GUEST_LINK_BASE_URL.length > 0,
      },
    });
  }),
);

tenantRouter.patch(
  '/settings/auto-guest-link',
  validate({ body: autoGuestLinkSchema }),
  asyncHandler(async (req, res) => {
    const auth = getTenantContext(req);
    const body = req.body as z.infer<typeof autoGuestLinkSchema>;

    if (body.enabled && !env.GUEST_LINK_BASE_URL) {
      throw ApiError.serviceUnavailable(
        'GUEST_LINK_NOT_CONFIGURED',
        'GUEST_LINK_BASE_URL is not set on the server, so there is no link to send yet.',
      );
    }

    const tenant = await Tenant.findByIdAndUpdate(
      auth.tenantId,
      {
        $set: {
          'autoGuestLink.enabled': body.enabled,
          ...(body.message ? { 'autoGuestLink.message': body.message } : {}),
        },
      },
      { new: true },
    )
      .select('autoGuestLink')
      .lean();
    if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Workspace not found');

    res.status(200).json({
      success: true,
      data: {
        enabled: tenant.autoGuestLink?.enabled ?? false,
        message: tenant.autoGuestLink?.message ?? DEFAULT_AUTO_GUEST_LINK_MESSAGE,
      },
    });
  }),
);
