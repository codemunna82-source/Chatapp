import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { ApiError } from '../../lib/ApiError';
import { env } from '../../config/env';
import { Tenant, DEFAULT_AUTO_GUEST_LINK_TEXT, DEFAULT_AUTO_GUEST_WELCOME } from './tenant.model';
import { resolveBusinessName, resolveBusinessNameForConversation } from '../guest/businessName';
import { findFirstPhoneNumberForTenant } from '../whatsapp/whatsapp.repository';

/**
 * Workspace-wide settings. MASTER_ADMIN only — these change what every
 * customer of the workspace experiences, which is not a member's call.
 */
export const tenantRouter = Router();

tenantRouter.use(requireAuth, requireRole('MASTER_ADMIN'));

const autoGuestLinkSchema = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(['text', 'template']).optional(),
    message: z.string().trim().min(1).max(900).optional(),
    templateName: z.string().trim().min(1).max(512).optional(),
    templateLanguage: z.string().trim().min(2).max(16).optional(),
    bodyVariable: z.enum(['none', 'customer_name']).optional(),
    /** How many times one customer may be sent the invitation. 1-3; see tenant.model.ts. */
    maxSends: z.coerce.number().int().min(1).max(3).optional(),
    holdWhatsAppUntilOpened: z.boolean().optional(),
    welcomeMessage: z.string().trim().max(900).optional(),
  })
  // Only template mode needs anything named. Refused here rather than at
  // send time, where the failure happens inside the webhook handler with
  // nobody watching: switched on with nothing to send looks on and sends
  // nothing forever. Text mode needs nothing, which is the point of it.
  .refine(
    (body) =>
      !body.enabled ||
      (body.mode ?? 'text') !== 'template' ||
      (body.templateName && body.templateLanguage),
    {
      message: 'Name the approved template and its language, or switch to plain text',
      path: ['templateName'],
    },
  );

/**
 * The address a template's URL button must be built on.
 *
 * Returned so the admin screen can print the exact string to paste into
 * WhatsApp Manager. Meta lets a template URL vary only in a suffix, so the
 * base has to be right before the template is submitted for review — and
 * getting it wrong is discovered days later, after approval.
 */
function guestLinkUrlPattern(): string | null {
  return env.GUEST_LINK_BASE_URL ? `${env.GUEST_LINK_BASE_URL}/c/{{1}}` : null;
}

tenantRouter.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const auth = getTenantContext(req);
    const tenant = await Tenant.findById(auth.tenantId).select('name displayName autoGuestLink').lean();
    if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Workspace not found');

    // What a customer would actually see, resolved through the same rule
    // the web window uses. Reported alongside the raw field because the
    // two differ whenever the field is blank, and an admin looking at an
    // empty box has no other way to find out what is being shown in their
    // name. The first connected number stands in for "any number": the
    // header is per-conversation, but a workspace's numbers almost always
    // carry one business name, and a preview that needs a conversation
    // picked first is a preview nobody looks at.
    const firstNumber = await findFirstPhoneNumberForTenant(auth.tenantId);
    const resolved = firstNumber
      ? await resolveBusinessNameForConversation(auth.tenantId, String(firstNumber._id))
      : resolveBusinessName({ displayName: tenant.displayName, tenantName: tenant.name });

    res.status(200).json({
      success: true,
      data: {
        name: tenant.name,
        displayName: tenant.displayName ?? '',
        /** The name customers see right now, and where it came from. */
        customerFacingName: resolved.name,
        customerFacingNameSource: resolved.source,
        /** Meta's approved name for the workspace's first number, if it has one. */
        whatsappVerifiedName: firstNumber?.verifiedName ?? '',
        autoGuestLink: {
          enabled: tenant.autoGuestLink?.enabled ?? false,
          /**
           * Whether anything will actually be sent.
           *
           * Distinct from `enabled`, and the difference is not pedantry: a
           * workspace that switched this on before it took a template has
           * `enabled: true` and no template, so the panel reads "On" while
           * the sender skips every message. Reporting only `enabled` is how
           * that goes unnoticed until a customer says nobody answered.
           */
          active: Boolean(
            tenant.autoGuestLink?.enabled &&
              ((tenant.autoGuestLink?.mode ?? 'text') !== 'template' ||
                (tenant.autoGuestLink?.templateName && tenant.autoGuestLink?.templateLanguage)),
          ),
          mode: tenant.autoGuestLink?.mode ?? 'text',
          message: tenant.autoGuestLink?.message ?? DEFAULT_AUTO_GUEST_LINK_TEXT,
          templateName: tenant.autoGuestLink?.templateName ?? '',
          templateLanguage: tenant.autoGuestLink?.templateLanguage ?? '',
          bodyVariable: tenant.autoGuestLink?.bodyVariable ?? 'none',
          maxSends: tenant.autoGuestLink?.maxSends ?? 1,
          holdWhatsAppUntilOpened: tenant.autoGuestLink?.holdWhatsAppUntilOpened ?? false,
          welcomeMessage: tenant.autoGuestLink?.welcomeMessage ?? DEFAULT_AUTO_GUEST_WELCOME,
        },
        // Without this the feature cannot work at all, and the admin has no
        // way to find that out short of turning it on and waiting for a
        // customer to receive nothing.
        guestLinkConfigured: env.GUEST_LINK_BASE_URL.length > 0,
        guestLinkUrlPattern: guestLinkUrlPattern(),
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
          ...(body.mode ? { 'autoGuestLink.mode': body.mode } : {}),
          ...(body.message ? { 'autoGuestLink.message': body.message } : {}),
          ...(body.templateName ? { 'autoGuestLink.templateName': body.templateName } : {}),
          ...(body.templateLanguage
            ? { 'autoGuestLink.templateLanguage': body.templateLanguage }
            : {}),
          ...(body.bodyVariable ? { 'autoGuestLink.bodyVariable': body.bodyVariable } : {}),
          ...(body.maxSends !== undefined ? { 'autoGuestLink.maxSends': body.maxSends } : {}),
          ...(body.holdWhatsAppUntilOpened !== undefined
            ? { 'autoGuestLink.holdWhatsAppUntilOpened': body.holdWhatsAppUntilOpened }
            : {}),
          // An empty string is a real instruction here — "stop greeting
          // them" — so it is written rather than treated as "unchanged".
          ...(body.welcomeMessage !== undefined
            ? { 'autoGuestLink.welcomeMessage': body.welcomeMessage }
            : {}),
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
        mode: tenant.autoGuestLink?.mode ?? 'text',
        message: tenant.autoGuestLink?.message ?? DEFAULT_AUTO_GUEST_LINK_TEXT,
        templateName: tenant.autoGuestLink?.templateName ?? '',
        templateLanguage: tenant.autoGuestLink?.templateLanguage ?? '',
        bodyVariable: tenant.autoGuestLink?.bodyVariable ?? 'none',
        maxSends: tenant.autoGuestLink?.maxSends ?? 1,
        holdWhatsAppUntilOpened: tenant.autoGuestLink?.holdWhatsAppUntilOpened ?? false,
        welcomeMessage: tenant.autoGuestLink?.welcomeMessage ?? DEFAULT_AUTO_GUEST_WELCOME,
      },
    });
  }),
);

/**
 * The name customers see.
 *
 * Its own route rather than a field on the auto-reply one: this changes
 * what a stranger reads at the top of the chat window, which is a
 * different kind of decision from how the invitation is worded, and
 * bundling them would mean saving one to change the other.
 *
 * An empty string is a real instruction — "stop overriding, go back to
 * the name WhatsApp holds for the number" — so it is written rather than
 * skipped as "unchanged".
 */
const businessProfileSchema = z.object({
  displayName: z.string().trim().max(120),
});

tenantRouter.patch(
  '/settings/profile',
  validate({ body: businessProfileSchema }),
  asyncHandler(async (req, res) => {
    const auth = getTenantContext(req);
    const { displayName } = req.body as z.infer<typeof businessProfileSchema>;

    const tenant = await Tenant.findByIdAndUpdate(
      auth.tenantId,
      { $set: { displayName } },
      { new: true },
    )
      .select('name displayName')
      .lean();
    if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Workspace not found');

    const firstNumber = await findFirstPhoneNumberForTenant(auth.tenantId);
    const resolved = firstNumber
      ? await resolveBusinessNameForConversation(auth.tenantId, String(firstNumber._id))
      : resolveBusinessName({ displayName: tenant.displayName, tenantName: tenant.name });

    res.status(200).json({
      success: true,
      data: {
        displayName: tenant.displayName ?? '',
        customerFacingName: resolved.name,
        customerFacingNameSource: resolved.source,
        whatsappVerifiedName: firstNumber?.verifiedName ?? '',
      },
    });
  }),
);
