import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/rbac.middleware';
import { validate } from '../../middleware/validate.middleware';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { ApiError } from '../../lib/ApiError';
import { encryptSecret } from '../../lib/crypto';
import { recordAudit } from '../audit/auditLog.service';
import { MetaApp, type MetaAppDoc } from './metaApp.model';
import { listMetaAppsForTenant, findMetaAppByIdAndTenant } from './metaApp.repository';

/**
 * Business Managers, as the workspace sees them.
 *
 * MASTER_ADMIN only: these are the credentials every message in the
 * workspace travels on, and a member has no business reading or replacing
 * them.
 */
export const metaAppRouter = Router();

metaAppRouter.use(requireAuth, requireRole('MASTER_ADMIN'));

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  appId: z.string().trim().regex(/^\d{5,}$/, 'A Meta App ID is digits only'),
  // Meta app secrets are 32 lowercase hex characters, always. Checked here
  // rather than only at signature time because the alternative is finding
  // out from a webhook that silently 401s days later — the exact failure
  // this whole feature exists to make diagnosable.
  appSecret: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{32}$/, 'That is not a Meta app secret — it should be 32 characters, 0-9 and a-f'),
  accessToken: z.string().trim().min(20).optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  appSecret: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{32}$/, 'That is not a Meta app secret — it should be 32 characters, 0-9 and a-f')
    .optional(),
  accessToken: z.string().trim().min(20).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
});

/**
 * What a client is allowed to see.
 *
 * No secret, no token, not even a masked one. The only honest thing to
 * report is whether each is set, and the webhook URL to paste into Meta.
 */
function toPublic(app: MetaAppDoc, baseUrl: string) {
  return {
    id: String(app._id),
    name: app.name,
    appId: app.appId,
    status: app.status,
    webhookUrl: `${baseUrl}/api/webhooks/meta/app/${app.webhookRef}`,
    hasAccessToken: Boolean(app.accessTokenEnc),
    createdAt: app.get('createdAt'),
  };
}

function baseUrlFor(req: { protocol: string; get: (h: string) => string | undefined }): string {
  const host = req.get('host');
  return host ? `${req.protocol}://${host}` : '';
}

/**
 * A URL segment nobody can guess.
 *
 * The webhook URL is not itself a secret — the signature is what
 * authenticates a delivery — but a guessable one invites anyone to send
 * junk at a known endpoint, and every rejected delivery still costs a
 * lookup and a log line. 12 random bytes is cheap and ends that.
 */
function generateWebhookRef(): string {
  return randomBytes(9).toString('hex');
}

metaAppRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const auth = getTenantContext(req);
    const apps = await listMetaAppsForTenant(auth.tenantId);
    res.status(200).json({ success: true, data: apps.map((a) => toPublic(a, baseUrlFor(req))) });
  }),
);

metaAppRouter.post(
  '/',
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const auth = getTenantContext(req);
    const body = req.body as z.infer<typeof createSchema>;

    if (await MetaApp.exists({ tenantId: auth.tenantId, appId: body.appId })) {
      throw ApiError.conflict('META_APP_EXISTS', 'This Meta app is already added to the workspace.');
    }

    // The verify token is generated, not typed. It exists only to prove to
    // Meta that we are who we said when the callback URL was saved, so a
    // value the admin invents adds nothing except one more thing to get
    // wrong — and a weak one would let anyone complete the challenge.
    const verifyToken = randomBytes(24).toString('base64url');

    const app = await MetaApp.create({
      tenantId: auth.tenantId,
      name: body.name,
      appId: body.appId,
      webhookRef: generateWebhookRef(),
      appSecretEnc: encryptSecret(body.appSecret),
      verifyTokenEnc: encryptSecret(verifyToken),
      accessTokenEnc: body.accessToken ? encryptSecret(body.accessToken) : undefined,
    });

    await recordAudit({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: 'meta_app.create',
      targetType: 'MetaApp',
      targetId: app._id,
      // The app id is an identifier, not a credential. The secret and token
      // are neither logged nor audited — an audit trail is read by people.
      metadata: { name: app.name, appId: app.appId },
    });

    res.status(201).json({
      success: true,
      data: {
        ...toPublic(app, baseUrlFor(req)),
        // Returned exactly once, at creation, because Meta's dashboard asks
        // for it while the callback URL is being saved and there is no way
        // to read it back afterwards — it is stored encrypted.
        verifyToken,
      },
    });
  }),
);

metaAppRouter.patch(
  '/:id',
  validate({ body: updateSchema }),
  asyncHandler(async (req, res) => {
    const auth = getTenantContext(req);
    const body = req.body as z.infer<typeof updateSchema>;
    const app = await findMetaAppByIdAndTenant(req.params.id as string, auth.tenantId);
    if (!app) throw ApiError.notFound('META_APP_NOT_FOUND', 'Business Manager not found');

    if (body.name !== undefined) app.name = body.name;
    if (body.status !== undefined) app.status = body.status;
    if (body.appSecret) app.appSecretEnc = encryptSecret(body.appSecret);
    if (body.accessToken) app.accessTokenEnc = encryptSecret(body.accessToken);
    await app.save();

    await recordAudit({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: 'meta_app.update',
      targetType: 'MetaApp',
      targetId: app._id,
      // Which secrets were replaced, never what they were replaced with.
      metadata: {
        name: app.name,
        status: app.status,
        rotatedAppSecret: Boolean(body.appSecret),
        rotatedAccessToken: Boolean(body.accessToken),
      },
    });

    res.status(200).json({ success: true, data: toPublic(app, baseUrlFor(req)) });
  }),
);
