import { Types } from 'mongoose';
import { WhatsAppAccount, type WhatsAppAccountDoc } from './whatsappAccount.model';
import { WhatsAppPhoneNumber, type WhatsAppPhoneNumberDoc } from './whatsappPhoneNumber.model';
import { findPhoneNumbersByTenant, findPhoneNumberByIdAndTenant } from './whatsapp.repository';
import { ApiError } from '../../lib/ApiError';
import { env } from '../../config/env';
import { decryptSecret, isEncryptedEnvelope } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import { getMetaGateway } from '../../integrations/meta';
import type { MetaCredentials } from '../../integrations/meta';
import { describeNumberHealth, type NumberHealth } from './numberHealth';
import { registerPhoneNumber } from '../../integrations/meta/oauth';

/**
 * Turns a stored `accessTokenRef` into the token to actually call Meta with.
 *
 * The seed writes the literal placeholder `mock:demo-access-token`, which is
 * fine against the mock gateway and useless against the real one — a send
 * with it comes back as Meta error 190. So a `mock:` ref, an `env:` ref (what
 * findOrCreateRealAccount writes) or an empty one defers to META_ACCESS_TOKEN
 * from the environment, which is where a real System User token belongs. A
 * ref that is a real token is used as-is.
 *
 * This is the reason setting META_ACCESS_TOKEN on the server is enough to
 * start sending for real, without hand-editing the WhatsAppAccount document.
 *
 * `accessTokenEnc`, when present, wins over everything: it is the encrypted
 * token Embedded Signup obtained for this specific account, so a user who
 * connected their own WhatsApp sends with their own credentials rather than
 * the platform's.
 *
 * The three-way order — own encrypted token, then a literal stored token,
 * then the environment — is what lets the existing single-number
 * deployment keep working unchanged while connected accounts use their own.
 */
export function resolveAccessToken(accessTokenRef: string | undefined, accessTokenEnc?: string | null): string {
  if (accessTokenEnc && isEncryptedEnvelope(accessTokenEnc)) {
    try {
      return decryptSecret(accessTokenEnc);
    } catch (err) {
      // Almost always a rotated ENCRYPTION_KEY. Falling through to the
      // platform token would silently send this customer's messages from
      // the wrong number, so this fails instead and says what to do.
      logger.error({ err }, 'Stored WhatsApp token could not be decrypted');
      throw ApiError.badRequest(
        'WHATSAPP_TOKEN_UNREADABLE',
        'This WhatsApp connection could not be read. Please disconnect and connect WhatsApp again.',
      );
    }
  }

  const ref = accessTokenRef?.trim() ?? '';
  const isPlaceholder = ref.length === 0 || ref.startsWith('mock:') || ref.startsWith('env:') || ref.startsWith('enc:');
  const token = isPlaceholder ? env.META_ACCESS_TOKEN : ref;
  if (token.length === 0) {
    throw ApiError.badRequest(
      'WHATSAPP_TOKEN_NOT_CONFIGURED',
      'No WhatsApp access token is configured on the server, so messages cannot be sent.',
    );
  }
  return token;
}

/**
 * Resolves the Meta credentials needed to act on behalf of one tenant's
 * WhatsApp connection, from our own tenant-scoped records — never from
 * anything the Android client sends.
 */
/**
 * MetaCredentials plus the account they came from.
 *
 * The extra field stays out of MetaCredentials itself — that is the Meta
 * gateway's own type and has no business knowing about our documents. It
 * rides along here so the send path can mark this exact connection EXPIRED
 * when Meta rejects the token, instead of re-deriving it from an error
 * that carries no account context.
 */
export type ResolvedMetaCredentials = MetaCredentials & { whatsappAccountId: string };

export async function resolveMetaCredentialsForPhoneNumber(
  tenantId: string,
  whatsappPhoneNumberId: string,
): Promise<ResolvedMetaCredentials> {
  if (!Types.ObjectId.isValid(whatsappPhoneNumberId)) {
    throw ApiError.notFound('WHATSAPP_PHONE_NUMBER_NOT_FOUND', 'WhatsApp phone number not found');
  }
  const phoneNumber = await WhatsAppPhoneNumber.findOne({ _id: whatsappPhoneNumberId, tenantId });
  if (!phoneNumber) {
    throw ApiError.notFound('WHATSAPP_PHONE_NUMBER_NOT_FOUND', 'WhatsApp phone number not found');
  }

  const account = await WhatsAppAccount.findOne({ _id: phoneNumber.whatsappAccountId, tenantId }).select(
    '+accessTokenRef +accessTokenEnc',
  );
  if (!account) {
    throw ApiError.notFound('WHATSAPP_ACCOUNT_NOT_FOUND', 'WhatsApp account not found');
  }
  if (account.status !== 'CONNECTED') {
    throw ApiError.badRequest('WHATSAPP_ACCOUNT_NOT_CONNECTED', 'This WhatsApp account is not connected');
  }

  return {
    accessToken: resolveAccessToken(account.accessTokenRef, account.accessTokenEnc),
    phoneNumberId: phoneNumber.phoneNumberId,
    // Returned so the send path can mark this exact connection EXPIRED when
    // Meta rejects the token, rather than having to look it up again from
    // an error that carries no account context.
    whatsappAccountId: String(account._id),
  };
}

export async function resolveWabaCredentialsForTenant(
  tenantId: string,
  whatsappAccountId: string,
): Promise<{ accessToken: string; wabaId: string }> {
  if (!Types.ObjectId.isValid(whatsappAccountId)) {
    throw ApiError.notFound('WHATSAPP_ACCOUNT_NOT_FOUND', 'WhatsApp account not found');
  }
  const account = await WhatsAppAccount.findOne({ _id: whatsappAccountId, tenantId }).select('+accessTokenRef +accessTokenEnc');
  if (!account) {
    throw ApiError.notFound('WHATSAPP_ACCOUNT_NOT_FOUND', 'WhatsApp account not found');
  }
  return { accessToken: resolveAccessToken(account.accessTokenRef, account.accessTokenEnc), wabaId: account.wabaId };
}

export interface PublicWhatsAppNumber {
  id: string;
  /** Meta's own phone_number_id. Safe to show: it is an account identifier,
   *  not a credential — the access token it is used with never leaves the
   *  server (see resolveMetaCredentialsForPhoneNumber above). */
  phoneNumberId: string;
  displayPhoneNumber: string;
  status: string;
  qualityRating?: string;
  messagingLimitTier?: string;
  /** When quality and tier were last read from Meta — null if never. */
  healthCheckedAt?: string;
  /**
   * The rating turned into something actionable. Computed here rather than
   * in each client so every surface says the same thing about the same
   * number.
   */
  health: NumberHealth;
}

function toPublicWhatsAppNumber(n: WhatsAppPhoneNumberDoc): PublicWhatsAppNumber {
  return {
    id: String(n._id),
    phoneNumberId: n.phoneNumberId,
    displayPhoneNumber: n.displayPhoneNumber,
    status: n.status,
    qualityRating: n.qualityRating ?? undefined,
    messagingLimitTier: n.messagingLimitTier ?? undefined,
    healthCheckedAt: n.healthCheckedAt ? n.healthCheckedAt.toISOString() : undefined,
    health: describeNumberHealth({
      qualityRating: n.qualityRating ?? undefined,
      messagingLimitTier: n.messagingLimitTier ?? undefined,
      healthCheckedAt: n.healthCheckedAt ?? undefined,
    }),
  };
}

/**
 * How old a health reading may be before it is refetched.
 *
 * Meta moves a rating over hours, not seconds, so this is about being
 * usefully current rather than live — and about not spending a Graph call
 * every time the settings screen is opened.
 */
const HEALTH_STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * Re-reads one number's quality rating and messaging tier from Meta.
 *
 * Never throws. This runs behind a list request the user is waiting on,
 * and a Graph hiccup must not turn "here are your numbers" into an error —
 * the stored values are still shown, just older.
 */
export async function refreshNumberHealth(number: WhatsAppPhoneNumberDoc): Promise<void> {
  try {
    const credentials = await resolveMetaCredentialsForPhoneNumber(
      String(number.tenantId),
      String(number._id),
    );
    const profile = await getMetaGateway().fetchPhoneNumberProfile(
      credentials.accessToken,
      number.phoneNumberId,
    );

    number.qualityRating = profile.qualityRating;
    number.messagingLimitTier = profile.messagingLimitTier;
    number.nameStatus = profile.nameStatus;
    number.codeVerificationStatus = profile.codeVerificationStatus;
    number.healthCheckedAt = new Date();
    await number.save();
  } catch (err) {
    logger.warn({ err, phoneNumberId: number.phoneNumberId }, 'Could not refresh WhatsApp number health');
  }
}

/**
 * The tenant's WhatsApp numbers, for the admin's "sends from" picker and
 * the health screen.
 *
 * Stale readings are refreshed in the background rather than awaited: the
 * caller gets the stored values immediately and the next open shows the
 * new ones. Blocking this on a Graph round trip per number would make the
 * screen as slow as Meta happens to be that minute, for a rating that
 * moves over hours.
 */
export async function listPhoneNumbersForTenant(tenantId: string): Promise<PublicWhatsAppNumber[]> {
  const numbers = await findPhoneNumbersByTenant(tenantId);

  const cutoff = Date.now() - HEALTH_STALE_AFTER_MS;
  for (const number of numbers) {
    const checkedAt = number.healthCheckedAt?.getTime() ?? 0;
    if (checkedAt < cutoff) void refreshNumberHealth(number);
  }

  return numbers.map(toPublicWhatsAppNumber);
}

/**
 * Registers a real WhatsApp number on this tenant, replacing the demo
 * placeholder the seed writes.
 *
 * This exists because a fresh deployment ships with `DEMO-PHONE-000001`,
 * which is not a Meta id at all: every send against it fails, and nothing
 * short of hand-editing Mongo could change it. The id is verified with Meta
 * before it is stored, so a typo fails here — naming the problem — instead
 * of at 3am inside a send.
 */
/**
 * Registers an already-stored number for Cloud API use.
 *
 * Adding a number in WhatsApp Manager and pasting its id here is not
 * enough: until POST /{id}/register runs, Meta leaves the number
 * "Pending" and every send fails with a "not registered" error. The
 * Embedded Signup path has always done this; the admin path never did,
 * which is why a hand-registered number could look correctly configured
 * and still be unable to send.
 *
 * Meta's own error text is passed through. "Already registered" is not
 * treated as a failure — re-running this is how you recover from a partial
 * setup, and it has to be safe to repeat.
 */
export async function registerNumberForCloudApi(
  tenantId: string,
  numberId: string,
): Promise<{ registered: boolean; message: string }> {
  if (!env.META_REGISTER_PIN) {
    throw ApiError.badRequest(
      'REGISTER_PIN_MISSING',
      'META_REGISTER_PIN is not set on the server. Choose any six digits, set it, and keep it the same ' +
        'from then on — it is the number\'s two-step verification PIN, and changing it breaks re-registration.',
    );
  }

  const number = await findPhoneNumberByIdAndTenant(numberId, tenantId);
  if (!number) {
    throw ApiError.notFound('WHATSAPP_NUMBER_NOT_FOUND', 'That number is not registered to this workspace.');
  }

  const credentials = await resolveMetaCredentialsForPhoneNumber(tenantId, numberId);

  try {
    await registerPhoneNumber(credentials.accessToken, number.phoneNumberId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    // Meta says this when the number is already usable. Reporting it as a
    // failure would send an admin looking for a problem they do not have.
    if (/already registered/i.test(message)) {
      return { registered: true, message: 'This number was already registered for the Cloud API.' };
    }
    throw ApiError.badRequest('WHATSAPP_REGISTER_FAILED', `Meta refused the registration: ${message}`);
  }

  // Meta reports the new state a moment later, so this is read rather than
  // assumed — the point of the screen is to show what Meta thinks, not
  // what we hoped.
  await refreshNumberHealth(number);
  return { registered: true, message: 'Registered for the Cloud API. It may take a minute to leave "Pending".' };
}

export async function registerPhoneNumberForTenant(
  tenantId: string,
  phoneNumberId: string,
  wabaId?: string,
): Promise<PublicWhatsAppNumber> {
  const accessToken = resolveAccessToken(undefined); // env token; the account row may still hold the placeholder

  let profile;
  try {
    profile = await getMetaGateway().fetchPhoneNumberProfile(accessToken, phoneNumberId);
  } catch (err) {
    // Meta's own message is the useful part here — "Unsupported get request"
    // for a wrong id, "Invalid OAuth access token" for a bad token. Passing
    // it through is what makes this endpoint worth calling.
    throw ApiError.badRequest(
      'WHATSAPP_NUMBER_VERIFICATION_FAILED',
      `Meta rejected this phone number id: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  }

  // Another tenant already owns it — phoneNumberId is globally unique
  // because it is the only key an inbound webhook carries, so two tenants
  // sharing one would make inbound routing ambiguous.
  const existingAnywhere = await WhatsAppPhoneNumber.findOne({ phoneNumberId });
  if (existingAnywhere && String(existingAnywhere.tenantId) !== tenantId) {
    throw ApiError.conflict(
      'WHATSAPP_NUMBER_ALREADY_REGISTERED',
      'That WhatsApp number is already registered to another workspace.',
    );
  }

  const account = await findOrCreateRealAccount(tenantId, wabaId);

  if (existingAnywhere) {
    existingAnywhere.displayPhoneNumber = profile.displayPhoneNumber;
    existingAnywhere.qualityRating = profile.qualityRating;
    existingAnywhere.status = 'CONNECTED';
    existingAnywhere.whatsappAccountId = account._id;
    await existingAnywhere.save();
    return toPublicWhatsAppNumber(existingAnywhere);
  }

  const created = await WhatsAppPhoneNumber.create({
    tenantId,
    whatsappAccountId: account._id,
    phoneNumberId: profile.phoneNumberId,
    displayPhoneNumber: profile.displayPhoneNumber,
    qualityRating: profile.qualityRating,
    status: 'CONNECTED',
  });
  return toPublicWhatsAppNumber(created);
}

/**
 * The WhatsAppAccount to hang a newly registered number off.
 *
 * Reuses the tenant's existing account — including the seeded demo one,
 * upgraded in place with the real WABA id — rather than creating a second.
 * A tenant with two accounts would make template sync ambiguous, and the
 * demo row is otherwise dead weight nothing ever cleans up.
 */
async function findOrCreateRealAccount(tenantId: string, wabaId?: string): Promise<WhatsAppAccountDoc> {
  const existing = await WhatsAppAccount.findOne({ tenantId }).sort({ createdAt: 1 });
  if (existing) {
    if (wabaId && existing.wabaId !== wabaId) {
      existing.wabaId = wabaId;
      existing.status = 'CONNECTED';
      existing.connectedAt = existing.connectedAt ?? new Date();
      await existing.save();
    }
    return existing;
  }
  return WhatsAppAccount.create({
    tenantId,
    wabaId: wabaId ?? `PENDING-WABA-${tenantId}`,
    accessTokenRef: 'env:META_ACCESS_TOKEN', // resolveAccessToken() defers to the environment
    verifyToken: env.META_VERIFY_TOKEN || 'unset',
    status: 'CONNECTED',
    connectedAt: new Date(),
  });
}
