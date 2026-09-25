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
function toPublic(app: MetaAppDoc, baseUrl: string, numberCount = 0, accountStatus: string | null = null) {
  return {
    id: String(app._id),
    name: app.name,
    appId: app.appId,
    status: app.status,
    webhookUrl: `${baseUrl}/api/webhooks/meta/app/${app.webhookRef}`,
    hasAppSecret: Boolean(app.appSecretEnc),
    hasAccessToken: Boolean(app.accessTokenEnc),
    numberCount,
    // Meta's actual verdict on this Business Manager's credentials —
    // CONNECTED, PENDING, DISCONNECTED, ERROR or EXPIRED — worst-case
    // across every WhatsAppAccount it holds. Null when it holds none.
    // `status` above is only ever ACTIVE/DISABLED, an admin's own local
    // switch; this is the one that says whether Meta will actually accept
    // a send from anything under this BM right now.
    accountStatus,
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

// Worse (higher) beats better: one broken account under a Business Manager
// is enough to call the whole thing broken, because the admin cares
// whether anything under it can send right now, not the average.
const ACCOUNT_STATUS_SEVERITY: Record<string, number> = {
  CONNECTED: 0,
  PENDING: 1,
  DISCONNECTED: 2,
  EXPIRED: 3,
  ERROR: 4,
};

/**
 * The worst WhatsAppAccount status under each Business Manager — Meta's
 * real, current verdict on whether anything can actually send from it.
 *
 * `MetaApp.status` (ACTIVE/DISABLED) is a switch an admin sets by hand and
 * says nothing about Meta's side; this is what answers "kon sa BM disable
 * hai" for real, from the same accountStatus this session already
 * surfaced per number, aggregated up to the Business Manager an admin
 * actually manages credentials for.
 */
async function summarizeAccountStatusByApp(tenantId: string): Promise<Map<string, string>> {
  const accounts = await WhatsAppAccount.find({ tenantId }).select('metaAppId status').lean();
  const worst = new Map<string, string>();
  for (const a of accounts) {
    const key = a.metaAppId ? String(a.metaAppId) : '';
    const current = worst.get(key);
    if (!current || (ACCOUNT_STATUS_SEVERITY[a.status] ?? 0) > (ACCOUNT_STATUS_SEVERITY[current] ?? 0)) {
      worst.set(key, a.status);
    }
  }
  return worst;
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
function defaultAppRow(baseUrl: string, numberCount: number, accountStatus: string | null) {
  return {
    id: null,
    name: 'Server default',
    appId: env.META_APP_ID || null,
    status: 'ACTIVE' as const,
    webhookUrl: `${baseUrl}/api/webhooks/meta`,
    hasAppSecret: env.META_APP_SECRET.length > 0,
    hasAccessToken: env.META_ACCESS_TOKEN.length > 0,
    numberCount,
    accountStatus,
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
    const [apps, counts, accountStatuses] = await Promise.all([
      listMetaAppsForTenant(auth.tenantId),
      countNumbersByApp(auth.tenantId),
      summarizeAccountStatusByApp(auth.tenantId),
    ]);

    // The environment's own configuration first: it is the oldest and, on
    // most deployments, the only one holding any numbers.
    res.status(200).json({
      success: true,
      data: [
        defaultAppRow(baseUrl, counts.get('') ?? 0, accountStatuses.get('') ?? null),
        ...apps.map((a) =>
          toPublic(a, baseUrl, counts.get(String(a._id)) ?? 0, accountStatuses.get(String(a._id)) ?? null),
        ),
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

/**
 * A fresh verify token for an app whose first one was not captured.
 *
 * The token is shown once, at creation, and is stored encrypted — there is
 * no reading it back. That was the whole design and it was missing its
 * other half: an admin who closed the panel before copying had no way
 * forward at all, because there is no way to read the token and no way to
 * delete the app and start again. One misread screen and the Business
 * Manager was unusable.
 *
 * Minting a new one is safe because the token proves nothing on its own.
 * It is matched against hub.verify_token on Meta's subscription challenge
 * and never again; it does not authenticate deliveries, which are checked
 * by HMAC against the app secret. So the cost of rotating it is precisely
 * that the callback URL has to be saved in Meta's dashboard once more —
 * which is what the admin was going to do anyway.
 *
 * POST rather than GET because it CHANGES the token: a GET that quietly
 * broke an already-configured webhook would be the worse mistake.
 */
metaAppRouter.post(
  '/:id/verify-token',
  asyncHandler(async (req, res) => {
    const auth = getTenantContext(req);
    const app = await findMetaAppByIdAndTenant(req.params.id as string, auth.tenantId);
    if (!app) throw ApiError.notFound('META_APP_NOT_FOUND', 'Business Manager not found');

    const verifyToken = randomBytes(24).toString('base64url');
    app.verifyTokenEnc = encryptSecret(verifyToken);
    await app.save();

    await recordAudit({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: 'meta_app.verify_token.rotate',
      targetType: 'MetaApp',
      targetId: app._id,
      // That it was rotated, never the value. An audit trail is read by people.
      metadata: { name: app.name, appId: app.appId },
    });

    res.status(200).json({
      success: true,
      data: {
        ...toPublic(app, baseUrlFor(req)),
        // Once again exactly once, and the response says what has to
        // happen next — the old token stops working the moment this is
        // saved, so an already-verified webhook must be re-saved in Meta.
        verifyToken,
        mustReconfigureInMeta: true,
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

    // A fresh token deserves a fresh chance: every account under this
    // Business Manager that Meta had rejected the OLD token on is stuck
    // reporting "not connected" until something explicitly says otherwise —
    // resolveMetaCredentialsForPhoneNumber refuses to even try a send while
    // status stays EXPIRED, new token or not. Without this, pasting in a
    // working replacement here was the whole fix and nothing ever noticed.
    // Self-correcting either way: if the new token is ALSO bad, the next
    // send attempt marks it EXPIRED again (see markConnectionExpired).
    let reconnected = 0;
    if (body.accessToken) {
      const result = await WhatsAppAccount.updateMany(
        { tenantId: auth.tenantId, metaAppId: app._id, status: 'EXPIRED' },
        { $set: { status: 'CONNECTED' } },
      );
      reconnected = result.modifiedCount;
    }

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
        reconnectedAccounts: reconnected,
      },
    });

    res.status(200).json({ success: true, data: toPublic(app, baseUrlFor(req)) });
  }),
);
