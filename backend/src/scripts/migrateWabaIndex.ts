/**
 * Manual escape hatch for the WhatsApp wabaId index migration.
 *
 * The server already runs this at boot (see migrateWabaIndexAtBoot), so
 * this exists for the case where that failed and the log told you to retry
 * it — or to run it against a database the app is not currently pointed at.
 *
 *   npm run migrate:waba-index
 */
import { connectMongo, disconnectMongo } from '../lib/mongoose';
import { logger } from '../lib/logger';
import { migrateWabaIndex } from '../modules/whatsapp/wabaIndexMigration';

async function run(): Promise<void> {
  await connectMongo();
  await migrateWabaIndex();
  logger.info('WhatsAppAccount indexes synced.');
  await disconnectMongo();
}

run().catch((err) => {
  logger.error({ err }, 'migrateWabaIndex failed');
  process.exitCode = 1;
});
