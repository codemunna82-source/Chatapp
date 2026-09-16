/**
 * Manual escape hatch for the per-number conversation index migration.
 *
 * The server already runs this at boot (see
 * migrateConversationNumberIndexAtBoot), so this exists for the case where
 * that failed and the log told you to retry it — or to run it against a
 * database the app is not currently pointed at.
 *
 *   npm run migrate:conversation-number-index
 */
import { connectMongo, disconnectMongo } from '../lib/mongoose';
import { logger } from '../lib/logger';
import { migrateConversationNumberIndex } from '../modules/conversations/conversationNumberIndexMigration';

async function run(): Promise<void> {
  await connectMongo();
  await migrateConversationNumberIndex();
  logger.info('Conversation indexes synced.');
  await disconnectMongo();
}

run().catch((err) => {
  logger.error({ err }, 'migrateConversationNumberIndex failed');
  process.exitCode = 1;
});
