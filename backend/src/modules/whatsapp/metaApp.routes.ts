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
import { env } from '../../config/env';
import { MetaApp, type MetaAppDoc } from './metaApp.model';
import { WhatsAppAccount } from './whatsappAccount.model';
import { WhatsAppPhoneNumber } from './whatsappPhoneNumber.model';
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
 * No secret, no token, not even a masked one — and that is not caution
 * for its own sake. These credentials can send as the business to any of
 * its customers, and an admin page is one shoulder-surf, one screenshot
 * in a support chat and one browser extension away from public. Whether
 * each is SET is the useful fact and the whole of it; a masked value adds
 * nothing but an invitation to try reading it.
 *
 * The App ID is shown in full. It is an identifier, not a credential —
 * Meta puts it in URLs and client-side config — and hiding it would only
 * make the page harder to match against Meta's dashboard.
 */
function toPublic(app: MetaAppDoc, baseUrl: string, numberCount = 0) {
  return {
    id: String(app._id),
    name: app.name,
    appId: app.appId,
    status: app.status,
    webhookUrl: `${baseUrl}/api/webhooks/meta/app/${app.webhookRef}`,
    hasAppSecret: Boolean(app.appSecretEnc),
    hasAccessToken: Boolean(app.accessTokenEnc),
    numberCount,
    isDefault: false,
    createdAt: app.get('createdAt'),
  };
}

/**
 * How many WhatsApp numbers sit under each Business Manager.
 *
 * Numbers point at accounts and accounts point at an app, so this is two
 * hops rather than a field on the number — denormalising it would mean a
 * count that drifts the first time an account is reassigned.
 *
 * Keyed by app id, with the empty string standing for "no Business
 * Manager", which is where every number added before any of this existed
 * still lives.
 */
async function countNumbersByApp(tenantId: string): Promise<Map<string, number>> {
  const [accounts, numbers] = await Promise.all([
    WhatsAppAccount.find({ tenantId }).select('metaAppId').lean(),
    WhatsAppPhoneNumber.find({ tenantId }).select('whatsappAccountId').lean(),
  ]);

  const appOfAccount = new Map<string, string>();
  for (const a of accounts) {
    appOfAccount.set(String(a._id), a.metaAppId ? String(a.metaAppId) : '');
  }

  const counts = new Map<string, number>();
  for (const n of numbers) {
    const key = appOfAccount.get(String(n.whatsappAccountId)) ?? '';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The configuration this deployment has been running on all along.
 *
 * Presented as a row beside the added Business Managers rather than left
 * invisible, because it IS one — it holds an app id, a secret, a token and
 * a set of numbers exactly like the others, and an admin who cannot see it
 * has no way to tell whether a number belongs to it or to something they
 * added. It carries no `id`, which is what marks it read-only: it lives in
 * the server's environment, and a form that appeared to edit it would be
 * lying.
 */
function defaultAppRow(baseUrl: string, numberCount: number) {
  return {
    id: null,
    name: 'Server default',
    appId: env.META_APP_ID || null,
    status: 'ACTIVE' as const,
    webhookUrl: `${baseUrl}/api/webhooks/meta`,
    hasAppSecret: env.META_APP_SECRET.length > 0,
    hasAccessToken: env.META_ACCESS_TOKEN.length > 0,
    numberCount,
    isDefault: true,
    createdAt: null,
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
    const baseUrl = baseUrlFor(req);
    const [apps, counts] = await Promise.all([
      listMetaAppsForTenant(auth.tenantId),
      countNumbersByApp(auth.tenantId),
    ]);

    // The environment's own configuration first: it is the oldest and, on
    // most deployments, the only one holding any numbers.
    res.status(200).json({
      success: true,
      data: [
        defaultAppRow(baseUrl, counts.get('') ?? 0),
        ...apps.map((a) => toPublic(a, baseUrl, counts.get(String(a._id)) ?? 0)),
      ],
    });
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
