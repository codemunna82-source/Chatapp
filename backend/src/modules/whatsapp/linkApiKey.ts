import { createHash, randomBytes } from 'node:crypto';
import { WhatsAppPhoneNumber, type WhatsAppPhoneNumberDoc } from './whatsappPhoneNumber.model';

/**
 * The key an external automation presents to fetch a private-chat link —
 * see guestLinkApi.routes.ts.
 *
 * Prefixed so it is recognisable at a glance wherever it ends up pasted
 * (a BSP's HTTP-request node, a support ticket, a screenshot), the same
 * reason GitHub's and Stripe's own tokens carry one.
 */
const KEY_PREFIX = 'vxlink_';

export function generateLinkApiKey(): string {
  return `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function hashLinkApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Issues a fresh key for this number, overwriting any earlier one.
 *
 * Only ever returns the plaintext here, at generation — every other read
 * of this number gets the hash or nothing, the same contract a password
 * reset follows. Generating a new key invalidates the old one outright
 * rather than allowing both, so a leaked key can actually be revoked
 * instead of merely joined by a second one nobody remembers to remove.
 */
export async function rotateLinkApiKey(
  phoneNumberId: string,
  tenantId: string,
): Promise<{ key: string; createdAt: Date } | null> {
  const key = generateLinkApiKey();
  const linkApiKeyCreatedAt = new Date();
  const updated = await WhatsAppPhoneNumber.findOneAndUpdate(
    { _id: phoneNumberId, tenantId },
    { $set: { linkApiKeyHash: hashLinkApiKey(key), linkApiKeyCreatedAt } },
    { new: true },
  );
  if (!updated) return null;
  return { key, createdAt: linkApiKeyCreatedAt };
}

export async function revokeLinkApiKey(phoneNumberId: string, tenantId: string): Promise<boolean> {
  const updated = await WhatsAppPhoneNumber.findOneAndUpdate(
    { _id: phoneNumberId, tenantId },
    { $unset: { linkApiKeyHash: '', linkApiKeyCreatedAt: '' } },
  );
  return Boolean(updated);
}

/**
 * Resolves a presented key to the one number it belongs to.
 *
 * The key is this lookup's only input — there is no separate tenant or
 * number id in the request, because the automation calling it has neither.
 * A wrong or revoked key returns null rather than a reason, the same as
 * every other credential check in this codebase: telling an unauthenticated
 * caller WHY their key failed is a way to let them probe for a real one.
 */
export async function findPhoneNumberByLinkApiKey(
  key: string,
): Promise<WhatsAppPhoneNumberDoc | null> {
  if (!key) return null;
  return WhatsAppPhoneNumber.findOne({ linkApiKeyHash: hashLinkApiKey(key) }).select(
    '+linkApiKeyHash',
  );
}
