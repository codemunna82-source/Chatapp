import { Types } from 'mongoose';
import { WhatsAppAccount, type WhatsAppAccountDoc, type WabaStatus } from './whatsappAccount.model';
import { WhatsAppPhoneNumber, type WhatsAppPhoneNumberDoc } from './whatsappPhoneNumber.model';

export async function findWabaAccountsByTenant(tenantId: string): Promise<WhatsAppAccountDoc[]> {
  return WhatsAppAccount.find({ tenantId }).sort({ createdAt: -1 });
}

export async function findWabaAccountByIdAndTenant(
  id: string,
  tenantId: string,
): Promise<WhatsAppAccountDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return WhatsAppAccount.findOne({ _id: id, tenantId });
}

export interface CreateWabaAccountInput {
  tenantId: string;
  wabaId: string;
  businessName?: string;
  accessTokenRef: string;
  verifyToken: string;
  status?: WabaStatus;
}

export async function createWabaAccount(input: CreateWabaAccountInput): Promise<WhatsAppAccountDoc> {
  return WhatsAppAccount.create(input);
}

export async function findPhoneNumbersByAccountAndTenant(
  whatsappAccountId: string,
  tenantId: string,
): Promise<WhatsAppPhoneNumberDoc[]> {
  return WhatsAppPhoneNumber.find({ whatsappAccountId, tenantId });
}

export interface CreatePhoneNumberInput {
  tenantId: string;
  whatsappAccountId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  qualityRating?: string;
}

export async function createPhoneNumber(input: CreatePhoneNumberInput): Promise<WhatsAppPhoneNumberDoc> {
  return WhatsAppPhoneNumber.create(input);
}

/**
 * The tenant's first configured WhatsApp number. Used when starting a
 * conversation from the app: outbound chats have no inbound webhook to say
 * which number they belong to, so they default to the tenant's own.
 */
export async function findFirstPhoneNumberForTenant(tenantId: string): Promise<WhatsAppPhoneNumberDoc | null> {
  return WhatsAppPhoneNumber.findOne({ tenantId }).sort({ createdAt: 1 });
}

/**
 * The ONE legitimate tenant-unscoped lookup in the whole codebase: resolving
 * which tenant an inbound Meta webhook belongs to, keyed by Meta's
 * `phone_number_id`. Every caller of this function must treat its result as
 * the tenant boundary for everything else the webhook does — never accept a
 * tenantId claimed elsewhere in the payload.
 */
export async function findPhoneNumberByMetaId(phoneNumberId: string): Promise<WhatsAppPhoneNumberDoc | null> {
  return WhatsAppPhoneNumber.findOne({ phoneNumberId });
}
