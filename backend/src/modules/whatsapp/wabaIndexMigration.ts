import { logger } from '../../lib/logger';
import { WhatsAppAccount } from './whatsappAccount.model';

const OLD_INDEX = 'wabaId_1';

/**
 * Replaces the old globally-unique index on WhatsAppAccount.wabaId with the
 * per-tenant one.
 *
 * This cannot be left to Mongoose. autoIndex creates indexes a schema
 * declares but never drops ones it no longer declares, so shipping the new
 * model leaves the old unique index in place — and the second tenant to
 * onboard the same business fails Embedded Signup with a duplicate-key
 * error that reads like a bug rather than a policy.
 *
 * Runs at boot rather than as a deploy step someone has to remember, and is
 * idempotent: a missing old index is not an error, and syncIndexes() is a
 * no-op once the new one exists.
 */
export async function migrateWabaIndex(): Promise<void> {
  const collection = WhatsAppAccount.collection;

  const indexes = await collection.indexes();
  const old = indexes.find((i) => i.name === OLD_INDEX);

  if (!old) {
    logger.debug('wabaId_1 index not present — nothing to migrate');
  } else if (!old.unique) {
    // A non-unique index of the same name is not what this migration is
    // about; dropping it would be a silent, unrelated change.
    logger.warn('wabaId_1 exists but is not unique — leaving it alone');
  } else {
    await collection.dropIndex(OLD_INDEX);
    logger.info('Dropped the global unique index on WhatsAppAccount.wabaId');
  }

  // Fails loudly if existing rows violate { tenantId, wabaId } — two
  // documents genuinely sharing both is a data problem a migration must
  // not paper over.
  await WhatsAppAccount.syncIndexes();
}

/**
 * Boot wrapper: logs and continues rather than throwing.
 *
 * Refusing to start over an index would take the whole API down for a
 * problem that only affects onboarding a second tenant onto one business.
 * The error message says exactly what is still wrong and how to fix it by
 * hand.
 */
export async function migrateWabaIndexAtBoot(): Promise<void> {
  try {
    await migrateWabaIndex();
  } catch (err) {
    logger.error(
      { err },
      'WhatsApp wabaId index migration failed — a second workspace onboarding the same WhatsApp Business Account will fail with a duplicate-key error. Run `npm run migrate:waba-index` against this database to retry.',
    );
  }
}
