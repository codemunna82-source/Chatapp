/**
 * Drops the old globally-unique index on WhatsAppAccount.wabaId and creates
 * the per-tenant one in its place.
 *
 * This has to be an explicit migration. Mongoose's autoIndex creates indexes
 * a schema declares but never drops ones it no longer declares, so simply
 * shipping the new model leaves the old unique index in place — and the
 * second tenant to onboard the same WABA fails with a duplicate-key error
 * that reads like a bug rather than a policy decision.
 *
 * Safe to run more than once: a missing index is not an error here.
 *
 *   npm run migrate:waba-index
 */
import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { WhatsAppAccount } from '../modules/whatsapp/whatsappAccount.model';

const OLD_INDEX = 'wabaId_1';

async function run(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
  const collection = WhatsAppAccount.collection;

  const indexes = await collection.indexes();
  const old = indexes.find((i) => i.name === OLD_INDEX);

  if (!old) {
    logger.info(`No ${OLD_INDEX} index found — nothing to drop.`);
  } else if (!old.unique) {
    // A non-unique index of the same name is not the one this migration is
    // about; dropping it would be a silent, unrelated change.
    logger.warn(`${OLD_INDEX} exists but is not unique — leaving it alone.`);
  } else {
    await collection.dropIndex(OLD_INDEX);
    logger.info(`Dropped ${OLD_INDEX}.`);
  }

  // Creates { tenantId, wabaId } if it is not already there. Fails loudly
  // if existing data violates it — two tenants really sharing a wabaId row
  // is a data problem a migration must not paper over.
  await WhatsAppAccount.syncIndexes();
  logger.info('WhatsAppAccount indexes synced.');

  await mongoose.disconnect();
}

run().catch((err) => {
  logger.error({ err }, 'migrateWabaIndex failed');
  process.exitCode = 1;
});
