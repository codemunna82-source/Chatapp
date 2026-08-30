import { Types } from 'mongoose';
import { WhatsAppAccount, type WhatsAppAccountDoc } from './whatsappAccount.model';
import { WhatsAppPhoneNumber, type WhatsAppPhoneNumberDoc } from './whatsappPhoneNumber.model';
import { findPhoneNumbersByTenant } from './whatsapp.repository';
import { ApiError } from '../../lib/ApiError';
import { env } from '../../config/env';
import { decryptSecret, isEncryptedEnvelope } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import { getMetaGateway } from '../../integrations/meta';
import type { MetaCredentials } from '../../integrations/meta';

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
export async function resolveMetaCredentialsForPhoneNumber(
  tenantId: string,
  whatsappPhoneNumberId: string,
): Promise<MetaCredentials> {
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
}

function toPublicWhatsAppNumber(n: WhatsAppPhoneNumberDoc): PublicWhatsAppNumber {
  return {
    id: String(n._id),
    phoneNumberId: n.phoneNumberId,
    displayPhoneNumber: n.displayPhoneNumber,
    status: n.status,
    qualityRating: n.qualityRating ?? undefined,
  };
}

/** The tenant's WhatsApp numbers, for the admin's "sends from" picker. */
export async function listPhoneNumbersForTenant(tenantId: string): Promise<PublicWhatsAppNumber[]> {
  const numbers = await findPhoneNumbersByTenant(tenantId);
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
