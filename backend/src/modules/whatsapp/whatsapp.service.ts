import { Types } from 'mongoose';
import { WhatsAppAccount } from './whatsappAccount.model';
import { WhatsAppPhoneNumber } from './whatsappPhoneNumber.model';
import { findPhoneNumbersByTenant } from './whatsapp.repository';
import { ApiError } from '../../lib/ApiError';
import { env } from '../../config/env';
import type { MetaCredentials } from '../../integrations/meta';

/**
 * Turns a stored `accessTokenRef` into the token to actually call Meta with.
 *
 * The seed writes the literal placeholder `mock:demo-access-token`, which is
 * fine against the mock gateway and useless against the real one — a send
 * with it comes back as Meta error 190. So a `mock:` ref (or an empty one)
 * defers to META_ACCESS_TOKEN from the environment, which is where a real
 * System User token belongs. A ref that is a real token is used as-is.
 *
 * This is the reason setting META_ACCESS_TOKEN on the server is enough to
 * start sending for real, without hand-editing the WhatsAppAccount document.
 *
 * MVP note: refs are still the credential value itself rather than pointers
 * into a secret store. Before production, swap this for a proper
 * secrets-manager fetch keyed by the ref — no caller needs to change.
 */
export function resolveAccessToken(accessTokenRef: string | undefined): string {
  const ref = accessTokenRef?.trim() ?? '';
  const isPlaceholder = ref.length === 0 || ref.startsWith('mock:');
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
    '+accessTokenRef',
  );
  if (!account) {
    throw ApiError.notFound('WHATSAPP_ACCOUNT_NOT_FOUND', 'WhatsApp account not found');
  }
  if (account.status !== 'CONNECTED') {
    throw ApiError.badRequest('WHATSAPP_ACCOUNT_NOT_CONNECTED', 'This WhatsApp account is not connected');
  }

  return { accessToken: resolveAccessToken(account.accessTokenRef), phoneNumberId: phoneNumber.phoneNumberId };
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
  return { accessToken: resolveAccessToken(account.accessTokenRef), wabaId: account.wabaId };
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
