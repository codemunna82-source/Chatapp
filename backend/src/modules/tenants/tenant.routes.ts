import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { ApiError } from '../../lib/ApiError';
import { Tenant, DEFAULT_AUTO_GUEST_LINK_TEXT, DEFAULT_AUTO_GUEST_WELCOME } from './tenant.model';
import { resolveBusinessName, resolveBusinessNameForConversation } from '../guest/businessName';
import { findFirstPhoneNumberForTenant } from '../whatsapp/whatsapp.repository';
import { AVATAR_MAX_SIZE_BYTES } from '../media/avatarAsset';
import { CONTENT_POLICY_MESSAGE, findPolicyViolation } from '../messages/contentPolicy';
import { guestLinkUrlPattern } from './guestDomain';
import {
  assignPoolDomain,
  claimCustomDomain,
  clearGuestDomain,
  getGuestDomainSettings,
  guestLinkBaseUrlFor,
  verifyCustomDomain,
} from './guestDomain.service';
import {
  getTenantAvatar,
  removeTenantAvatar,
  resolveBusinessAvatar,
  tenantAvatarVersion,
  updateTenantAvatar,
} from './tenantAvatar.service';

/**
 * Workspace-wide settings. MASTER_ADMIN only — these change what every
 * customer of the workspace experiences, which is not a member's call.
 */
export const tenantRouter = Router();

tenantRouter.use(requireAuth, requireRole('MASTER_ADMIN'));

// In memory, never local disk: the bytes go straight to Cloudinary, and a
// deployment can be replaced between two requests.
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_SIZE_BYTES },
});

/**
 * The workspace's photo, shown to every customer above their chat window.
 *
 * Its own routes rather than a field on the profile PATCH below, because
 * it is bytes: a multipart body and a JSON one cannot share a handler,
 * and bundling them would mean re-uploading the photo to rename the
 * business.
 */
tenantRouter.patch(
  '/settings/profile/avatar',
  avatarUpload.single('file'),
  asyncHandler(async (req, res) => {
    const auth = getTenantContext(req);
    if (!req.file) throw ApiError.badRequest('FILE_REQUIRED', 'Choose an image to upload');
    const result = await updateTenantAvatar(
      auth.tenantId,
      auth.userId,
      req.file.buffer,
      req.file.mimetype,
    );
    res.status(200).json({ success: true, data: result });
  }),
);

tenantRouter.delete(
  '/settings/profile/avatar',
  asyncHandler(async (req, res) => {
    const auth = getTenantContext(req);
    await removeTenantAvatar(auth.tenantId, auth.userId);
    res.status(200).json({ success: true, data: { avatarUpdatedAt: null } });
  }),
);

tenantRouter.get(
  '/settings/profile/avatar',
  asyncHandler(async (req, res) => {
    const auth = getTenantContext(req);
    const { data, contentType } = await getTenantAvatar(auth.tenantId);
    res.setHeader('Content-Type', contentType);
    // Keyed by ?v=<avatarUpdatedAt>, so a long cache is safe: a new photo
    // is a new URL.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.status(200).send(data);
  }),
);

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
  )
  /**
   * The content policy, applied when the wording is SAVED.
   *
   * sendOutboundMessage already refuses this text at send time, so nothing
   * gets out either way. The reason to check it here too is that these two
   * messages are the only ones on the platform that go out with no human
   * in the loop — they fire from the webhook handler the moment a customer
   * writes in. Caught only at send time, a blocked wording would look
   * saved, look enabled, and silently fail against every customer forever,
   * which is precisely the failure the template check above exists to
   * prevent. See contentPolicy.ts.
   */
  .refine((body) => !findPolicyViolation(body.message), {
    message: CONTENT_POLICY_MESSAGE,
    path: ['message'],
  })
  .refine((body) => !findPolicyViolation(body.welcomeMessage), {
    message: CONTENT_POLICY_MESSAGE,
    path: ['welcomeMessage'],
  });


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
    // Per workspace now, not from the environment: a workspace on its
    // own chat domain needs a DIFFERENT template URL pattern from one on
    // the shared domain, and printing the shared one to both is how a
    // template gets approved against an address its links never use.
    const linkBaseUrl = await guestLinkBaseUrlFor(auth.tenantId);

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
        // Absent means no photo, which is what stops a client asking for
        // one — the same contract every other avatar here uses.
        avatarUpdatedAt: await tenantAvatarVersion(auth.tenantId),
        /**
         * What the CUSTOMER actually sees, which is not always the field
         * above: with no workspace photo set, the window shows the
         * profile picture of the person answering the number — the same
         * person whose name it already shows.
         *
         * Reported separately so the settings preview can be honest
         * about which it is, the way it already is about the name.
         */
        customerFacingAvatar: firstNumber
          ? await resolveBusinessAvatar(auth.tenantId, String(firstNumber._id))
          : null,
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
        guestLinkConfigured: linkBaseUrl.length > 0,
        guestLinkUrlPattern: guestLinkUrlPattern(linkBaseUrl),
        /** Which domain those links are built on, and how it got there. */
        guestDomain: await getGuestDomainSettings(auth.tenantId),
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

    if (body.enabled && !(await guestLinkBaseUrlFor(auth.tenantId))) {
      throw ApiError.serviceUnavailable(
        'GUEST_LINK_NOT_CONFIGURED',
        'No chat domain is configured on the server, so there is no link to send yet.',
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
        avatarUpdatedAt: await tenantAvatarVersion(auth.tenantId),
        customerFacingAvatar: firstNumber
          ? await resolveBusinessAvatar(auth.tenantId, String(firstNumber._id))
          : null,
      },
    });
  }),
);

/**
 * Which domain this workspace's private-chat links are built on.
 *
 * MASTER_ADMIN only, like everything else on this router, and this one
 * earns it twice over: the answer decides what address goes out to every
 * customer of the workspace, and a verified hostname becomes an origin
 * this API accepts credentialed browser requests from.
 *
 * Two routes in, matching the two arrangements that actually isolate a
 * workspace's link reputation from everyone else's (guestDomain.ts):
 * `/pool` takes one of ours, `/custom` claims one of theirs and then has
 * to pass a DNS check before it does anything.
 */
const poolDomainSchema = z.object({
  /** A specific spare domain. Omitted means "any free one". */
  host: z.string().trim().max(253).optional(),
});

const customDomainSchema = z.object({
  host: z.string().trim().min(3).max(253),
});

tenantRouter.get(
  '/settings/guest-domain',
  asyncHandler(async (req, res) => {
    const auth = getTenantContext(req);
    res.status(200).json({ success: true, data: await getGuestDomainSettings(auth.tenantId) });
  }),
);

tenantRouter.post(
  '/settings/guest-domain/pool',
  validate({ body: poolDomainSchema }),
  asyncHandler(async (req, res) => {
    const auth = getTenantContext(req);
    const body = req.body as z.infer<typeof poolDomainSchema>;
    res.status(200).json({ success: true, data: await assignPoolDomain(auth.tenantId, body.host) });
  }),
);

tenantRouter.post(
  '/settings/guest-domain/custom',
  validate({ body: customDomainSchema }),
  asyncHandler(async (req, res) => {
    const auth = getTenantContext(req);
    const body = req.body as z.infer<typeof customDomainSchema>;
    // 202, not 200: the domain is recorded but is deliberately doing
    // nothing yet. The DNS record in the response is the remaining work.
    res.status(202).json({ success: true, data: await claimCustomDomain(auth.tenantId, body.host) });
  }),
);

tenantRouter.post(
  '/settings/guest-domain/verify',
  asyncHandler(async (req, res) => {
    const auth = getTenantContext(req);
    res.status(200).json({ success: true, data: await verifyCustomDomain(auth.tenantId) });
  }),
);

tenantRouter.delete(
  '/settings/guest-domain',
  asyncHandler(async (req, res) => {
    const auth = getTenantContext(req);
    res.status(200).json({ success: true, data: await clearGuestDomain(auth.tenantId) });
  }),
);
