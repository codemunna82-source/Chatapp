import { Types } from 'mongoose';
import { WhatsAppAccount } from './whatsappAccount.model';
import { WhatsAppPhoneNumber } from './whatsappPhoneNumber.model';
import { ApiError } from '../../lib/ApiError';
import { decryptSecret, isEncryptedEnvelope } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import type { MetaCredentials } from '../../integrations/meta';
import type { WhatsAppAccountDoc } from './whatsappAccount.model';

/**
 * Reads an account's Meta access token, whichever form it is stored in.
 *
 * Two forms exist on purpose and only during the migration:
 *
 * - `accessTokenEnc` — the AES-256-GCM envelope every new onboarding
 *   writes. Preferred whenever present.
 * - `accessTokenRef` — plaintext, written before encryption existed.
 *   Still honoured so that connecting this change does not break an
 *   already-working WhatsApp account, and logged so the remaining ones are
 *   visible. scripts/backfillOwnerUserId.ts converts them.
 *
 * A decrypt failure is deliberately NOT caught here. A token we cannot
 * decrypt is a token we do not have; falling back to the legacy field
 * after a failed decrypt could send a stale credential to Meta.
 */
function readAccessToken(account: WhatsAppAccountDoc): string {
  if (isEncryptedEnvelope(account.accessTokenEnc)) {
    return decryptSecret(account.accessTokenEnc as string);
  }
  if (account.accessTokenRef) {
    logger.warn(
      { whatsappAccountId: String(account._id) },
      'WhatsApp access token is still stored in plaintext — run the ownerUserId/token backfill',
    );
    return account.accessTokenRef;
  }
  throw ApiError.badRequest(
    'WHATSAPP_ACCOUNT_NOT_CONNECTED',
    'This WhatsApp account has no usable access token — reconnect it.',
  );
}

/**
 * Resolves the Meta credentials needed to act on behalf of one tenant's
 * WhatsApp connection, from our own tenant-scoped records — never from
 * anything the Android client sends.
 *
 * Tokens are held encrypted at rest (AES-256-GCM, lib/crypto.ts) and
 * decrypted only here, at the moment of use. See readAccessToken for how
 * the legacy plaintext rows are still honoured during the migration.
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

  return { accessToken: readAccessToken(account), phoneNumberId: phoneNumber.phoneNumberId };
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
  return { accessToken: readAccessToken(account), wabaId: account.wabaId };
}
