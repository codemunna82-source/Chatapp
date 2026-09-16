import { logger } from '../../lib/logger';
import { Conversation } from './conversation.model';

/** The old key: one conversation per (tenant, contact), on any number. */
const OLD_INDEX = 'tenantId_1_contactId_1';
/** The new key: one per (tenant, contact, number). */
const NEW_INDEX = 'tenantId_1_contactId_1_whatsappPhoneNumberId_1';

/**
 * Replaces the old unique index on (tenantId, contactId) with the
 * per-number one.
 *
 * Mongoose cannot do this on its own: autoIndex creates the indexes a
 * schema declares but never drops ones it stopped declaring. Shipping the
 * new model alone would leave the old unique index in place, and it is
 * precisely the constraint the change exists to remove — the second thread
 * for a customer would fail with a duplicate-key error on an index nobody
 * can see in the code any more.
 *
 * Order matters. The new index is created first so uniqueness is never
 * unenforced in between; only then is the old one dropped. Creating the
 * new one cannot fail on existing data: every current row is unique on
 * (tenant, contact) already, so it is unique on the superset too.
 *
 * Dropping the old index costs no lookups: (tenantId, contactId) is a
 * prefix of the new key, so the queries that used it — deleting a
 * contact's chats, the duplicate-contact merge — are served by the new
 * index just as well.
 *
 * Idempotent — a missing old index is not an error, and createIndex on an
 * index that already exists is a no-op.
 */
export async function migrateConversationNumberIndex(): Promise<void> {
  const collection = Conversation.collection;

  await collection.createIndex(
    { tenantId: 1, contactId: 1, whatsappPhoneNumberId: 1 },
    { unique: true, name: NEW_INDEX },
  );

  const indexes = await collection.indexes();
  const old = indexes.find((i) => i.name === OLD_INDEX);

  if (!old) {
    logger.debug('tenantId_1_contactId_1 index not present — nothing to migrate');
    return;
  }

  if (!old.unique) {
    // A non-unique index of the same shape is a lookup index, not the
    // constraint this migration is about. Dropping it would be a silent,
    // unrelated performance change.
    logger.warn('tenantId_1_contactId_1 exists but is not unique — leaving it alone');
    return;
  }

  await collection.dropIndex(OLD_INDEX);
  logger.info('Dropped the one-conversation-per-contact unique index; chats are now per (contact, number)');
}

/**
 * Boot wrapper: logs and continues rather than throwing.
 *
 * Taking the whole API down over an index would be a worse outcome than the
 * problem it prevents, which is confined to customers who write to a second
 * WhatsApp number. The message says exactly what is still broken and how to
 * fix it by hand.
 */
export async function migrateConversationNumberIndexAtBoot(): Promise<void> {
  try {
    await migrateConversationNumberIndex();
  } catch (err) {
    logger.error(
      { err },
      'Conversation per-number index migration failed — a customer writing to a second WhatsApp number will have that message filed under the first number, where the second number\'s agent cannot see it. Run `npm run migrate:conversation-number-index` against this database to retry.',
    );
  }
}
