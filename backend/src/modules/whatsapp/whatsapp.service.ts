import { Types } from 'mongoose';
import { WhatsAppAccount } from './whatsappAccount.model';
import { WhatsAppPhoneNumber } from './whatsappPhoneNumber.model';
import { findPhoneNumbersByTenant } from './whatsapp.repository';
import { ApiError } from '../../lib/ApiError';
import type { MetaCredentials } from '../../integrations/meta';

/**
 * Resolves the Meta credentials needed to act on behalf of one tenant's
 * WhatsApp connection, from our own tenant-scoped records — never from
 * anything the Android client sends.
 *
 * MVP note: `WhatsAppAccount.accessTokenRef` is currently stored (and used
 * here) as the credential value itself, not a pointer into a real secret
 * store. Before production, swap this function's account lookup for a
 * proper secrets-manager fetch (AWS Secrets Manager, GCP Secret Manager,
 * Vault) keyed by that ref — nothing calling this function needs to change.
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
    '+accessTokenRef',
  );
  if (!account) {
    throw ApiError.notFound('WHATSAPP_ACCOUNT_NOT_FOUND', 'WhatsApp account not found');
  }
  if (account.status !== 'CONNECTED') {
    throw ApiError.badRequest('WHATSAPP_ACCOUNT_NOT_CONNECTED', 'This WhatsApp account is not connected');
  }

  return { accessToken: account.accessTokenRef, phoneNumberId: phoneNumber.phoneNumberId };
}

export async function resolveWabaCredentialsForTenant(
  tenantId: string,
  whatsappAccountId: string,
): Promise<{ accessToken: string; wabaId: string }> {
  if (!Types.ObjectId.isValid(whatsappAccountId)) {
    throw ApiError.notFound('WHATSAPP_ACCOUNT_NOT_FOUND', 'WhatsApp account not found');
  }
  const account = await WhatsAppAccount.findOne({ _id: whatsappAccountId, tenantId }).select('+accessTokenRef');
  if (!account) {
    throw ApiError.notFound('WHATSAPP_ACCOUNT_NOT_FOUND', 'WhatsApp account not found');
  }
  return { accessToken: account.accessTokenRef, wabaId: account.wabaId };
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

/** The tenant's WhatsApp numbers, for the admin's "sends from" picker. */
export async function listPhoneNumbersForTenant(tenantId: string): Promise<PublicWhatsAppNumber[]> {
  const numbers = await findPhoneNumbersByTenant(tenantId);
  return numbers.map((n) => ({
    id: String(n._id),
    phoneNumberId: n.phoneNumberId,
    displayPhoneNumber: n.displayPhoneNumber,
    status: n.status,
    qualityRating: n.qualityRating ?? undefined,
  }));
}
