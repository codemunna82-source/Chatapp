/**
 * Joins back up customers who exist twice — see
 * modules/contacts/mergeDuplicateContacts.ts for why they do.
 *
 * Dry run by default, because this rewrites conversation ownership across
 * a live inbox:
 *
 *   npm run merge:contacts           # report only, changes nothing
 *   npm run merge:contacts -- --apply
 */
import { connectMongo, disconnectMongo } from '../lib/mongoose';
import { logger } from '../lib/logger';
import { mergeDuplicateContacts } from '../modules/contacts/mergeDuplicateContacts';

async function run(): Promise<void> {
  const apply = process.argv.includes('--apply');
  await connectMongo();

  const report = await mergeDuplicateContacts({ dryRun: !apply });

  for (const line of report.details) {
    // eslint-disable-next-line no-console
    console.log(line);
  }
  // eslint-disable-next-line no-console
  console.log(
    apply
      ? `\nMerged ${report.contactsMerged} duplicate contacts across ${report.groupsFound} groups ` +
          `(${report.conversationsMerged} conversations joined, ${report.messagesMoved} messages moved).`
      : `\n${report.groupsFound} duplicate group(s) found. Nothing was changed — re-run with --apply.`,
  );

  await disconnectMongo();
}

run().catch((err) => {
  logger.error({ err }, 'mergeDuplicateContacts failed');
  process.exitCode = 1;
});
