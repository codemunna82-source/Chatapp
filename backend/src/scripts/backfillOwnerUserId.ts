import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../lib/mongoose';
import { logger } from '../lib/logger';
import { encryptSecret, isEncryptedEnvelope } from '../lib/crypto';
import { User } from '../modules/users/user.model';
import { WhatsAppAccount } from '../modules/whatsapp/whatsappAccount.model';
import { WhatsAppPhoneNumber } from '../modules/whatsapp/whatsappPhoneNumber.model';
import { Contact } from '../modules/contacts/contact.model';
import { Conversation } from '../modules/conversations/conversation.model';
import { Message } from '../modules/messages/message.model';

/**
 * One-time migration to per-user WhatsApp numbers.
 *
 * Three jobs, in this order and for this reason:
 *
 *  1. Backfill `ownerUserId` on every existing row, from the tenant's
 *     MASTER_ADMIN. Must happen FIRST — the new unique indexes include
 *     that field, and building them over rows where it is missing would
 *     collapse every one of a tenant's rows onto the same key.
 *  2. Encrypt any access token still sitting in plaintext.
 *  3. Drop the superseded unique indexes, then sync. This is the step
 *     that cannot be skipped: the app relies on Mongoose's `autoIndex`,
 *     which CREATES what a schema declares but never REMOVES what it no
 *     longer declares. So `{tenantId, contactId}` survives a deploy and
 *     keeps rejecting the second user's thread with the same customer —
 *     the exact thing this migration exists to allow. `syncIndexes()`
 *     below would also drop them, but naming them explicitly first keeps
 *     the intent auditable in the log and avoids depending on a sync over
 *     a large collection to do the important part.
 *
 * Idempotent throughout: safe to run twice, and safe to run against a
 * database that has already been partly migrated.
 *
 * Run with:  npm run migrate:owner-user-id
 * Add --dry-run to report what would change without writing anything.
 */

const DRY_RUN = process.argv.includes('--dry-run');

/** Indexes replaced by owner-scoped versions. Names are Mongo's own default naming. */
const SUPERSEDED_INDEXES: { collection: string; index: string }[] = [
  { collection: 'conversations', index: 'tenantId_1_contactId_1' },
  { collection: 'contacts', index: 'tenantId_1_phone_1' },
  { collection: 'whatsappaccounts', index: 'wabaId_1' },
];

async function resolveAdminByTenant(): Promise<Map<string, mongoose.Types.ObjectId>> {
  const admins = await User.find({ role: 'MASTER_ADMIN' }).select('_id tenantId').lean();
  const byTenant = new Map<string, mongoose.Types.ObjectId>();
  for (const admin of admins) {
    const tenantId = String(admin.tenantId);
    // First one wins. A tenant should only ever have one MASTER_ADMIN;
    // if somehow it has two, picking deterministically beats picking at
    // random on each run.
    if (!byTenant.has(tenantId)) byTenant.set(tenantId, admin._id);
  }
  return byTenant;
}

/**
 * `any` is the honest type here: this walks five models with different
 * shapes and touches exactly one field they all now share. Narrowing it
 * would mean a union that no caller benefits from.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = mongoose.Model<any>;

async function backfillCollection(
  label: string,
  collection: AnyModel,
  adminByTenant: Map<string, mongoose.Types.ObjectId>,
): Promise<void> {
  const missing = await collection.countDocuments({ ownerUserId: { $exists: false } });
  if (missing === 0) {
    logger.info({ label }, 'ownerUserId already set on every row — nothing to backfill');
    return;
  }

  logger.info({ label, missing, dryRun: DRY_RUN }, 'Backfilling ownerUserId');
  if (DRY_RUN) return;

  let updated = 0;
  let orphaned = 0;
  for (const [tenantId, adminId] of adminByTenant) {
    const result = await collection.updateMany(
      { tenantId: new mongoose.Types.ObjectId(tenantId), ownerUserId: { $exists: false } },
      { $set: { ownerUserId: adminId } },
    );
    updated += result.modifiedCount;
  }

  // Rows whose tenant has no MASTER_ADMIN cannot be assigned an owner.
  // Reported rather than guessed at: inventing an owner would hand one
  // user another tenant's conversations.
  orphaned = await collection.countDocuments({ ownerUserId: { $exists: false } });
  if (orphaned > 0) {
    logger.warn(
      { label, orphaned },
      'Rows left without ownerUserId — their tenant has no MASTER_ADMIN. They stay admin-visible only.',
    );
  }
  logger.info({ label, updated, orphaned }, 'Backfill complete');
}

async function encryptLegacyTokens(): Promise<void> {
  const accounts = await WhatsAppAccount.find({
    accessTokenRef: { $exists: true, $ne: null },
  }).select('+accessTokenRef +accessTokenEnc');

  const pending = accounts.filter((a) => a.accessTokenRef && !isEncryptedEnvelope(a.accessTokenEnc));
  if (pending.length === 0) {
    logger.info('No plaintext access tokens left to encrypt');
    return;
  }

  logger.info({ count: pending.length, dryRun: DRY_RUN }, 'Encrypting plaintext access tokens');
  if (DRY_RUN) return;

  for (const account of pending) {
    // $unset on the plaintext in the same update as the ciphertext, so a
    // crash between the two cannot leave the secret readable alongside its
    // encrypted copy.
    await WhatsAppAccount.updateOne(
      { _id: account._id },
      {
        $set: { accessTokenEnc: encryptSecret(account.accessTokenRef as string) },
        $unset: { accessTokenRef: 1 },
      },
    );
  }
  logger.info({ count: pending.length }, 'Access tokens encrypted');
}

async function dropSupersededIndexes(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle');

  for (const { collection, index } of SUPERSEDED_INDEXES) {
    try {
      const indexes = await db.collection(collection).indexes();
      if (!indexes.some((i) => i.name === index)) {
        logger.info({ collection, index }, 'Superseded index already gone');
        continue;
      }
      logger.info({ collection, index, dryRun: DRY_RUN }, 'Dropping superseded unique index');
      if (!DRY_RUN) await db.collection(collection).dropIndex(index);
    } catch (err) {
      // A missing collection is normal on a fresh database — the index
      // cannot be stale if the collection has never existed.
      logger.warn({ err, collection, index }, 'Could not drop index (collection may not exist yet)');
    }
  }
}

async function main(): Promise<void> {
  await connectMongo();
  logger.info({ dryRun: DRY_RUN }, 'Starting per-user WhatsApp migration');

  const adminByTenant = await resolveAdminByTenant();
  logger.info({ tenants: adminByTenant.size }, 'Resolved MASTER_ADMIN per tenant');
  if (adminByTenant.size === 0) {
    logger.warn('No MASTER_ADMIN users found — nothing can be assigned an owner');
  }

  // Order matters: owners first, then indexes. Reversing these would
  // build the new unique index while rows still share a null owner.
  await backfillCollection('whatsappaccounts', WhatsAppAccount as AnyModel, adminByTenant);
  await backfillCollection('whatsappphonenumbers', WhatsAppPhoneNumber as AnyModel, adminByTenant);
  await backfillCollection('contacts', Contact as AnyModel, adminByTenant);
  await backfillCollection('conversations', Conversation as AnyModel, adminByTenant);
  await backfillCollection('messages', Message as AnyModel, adminByTenant);

  await encryptLegacyTokens();
  await dropSupersededIndexes();

  // Builds the owner-scoped indexes the schemas now declare. Done after
  // the drops so Mongo is never asked to hold both the old and the new
  // unique constraint over the same rows.
  if (!DRY_RUN) {
    logger.info('Synchronising indexes to the current schemas');
    await Promise.all([
      WhatsAppAccount.syncIndexes(),
      WhatsAppPhoneNumber.syncIndexes(),
      Contact.syncIndexes(),
      Conversation.syncIndexes(),
      Message.syncIndexes(),
    ]);
  }

  logger.info({ dryRun: DRY_RUN }, 'Migration finished');
  await disconnectMongo();
}

main().catch(async (err) => {
  logger.error({ err }, 'Migration failed');
  await disconnectMongo().catch(() => undefined);
  process.exit(1);
});
