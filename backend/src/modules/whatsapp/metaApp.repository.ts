import { Types } from 'mongoose';
import { decryptSecret } from '../../lib/crypto';
import { MetaApp, type MetaAppDoc } from './metaApp.model';

/**
 * The app a webhook URL belongs to.
 *
 * Called on every inbound delivery before the body is trusted at all, so
 * it looks up ONLY by the URL segment — nothing from the payload, which at
 * that point is unauthenticated bytes from the open internet.
 */
export async function findMetaAppByWebhookRef(webhookRef: string): Promise<MetaAppDoc | null> {
  return MetaApp.findOne({ webhookRef: webhookRef.toLowerCase(), status: 'ACTIVE' }).select(
    '+appSecretEnc +verifyTokenEnc',
  );
}

export async function findMetaAppByIdAndTenant(id: string, tenantId: string): Promise<MetaAppDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return MetaApp.findOne({ _id: id, tenantId }).select('+appSecretEnc +verifyTokenEnc +accessTokenEnc');
}

export async function listMetaAppsForTenant(tenantId: string): Promise<MetaAppDoc[]> {
  return MetaApp.find({ tenantId }).sort({ createdAt: 1 });
}

/**
 * Decrypts one of an app's stored secrets.
 *
 * Returns null rather than throwing on a secret that will not decrypt.
 * This runs inside the webhook handler, where an exception means Meta
 * retries the delivery forever; a rotated ENCRYPTION_KEY should make that
 * one app's deliveries fail their signature check and say so in the log,
 * not take the whole endpoint down for every other app too.
 */
export function readAppSecret(envelope: string | null | undefined): string | null {
  if (!envelope) return null;
  try {
    return decryptSecret(envelope);
  } catch {
    return null;
  }
}
