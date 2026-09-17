import { logger } from '../../lib/logger';
import { Conversation } from './conversation.model';

/** The key this migration establishes: one thread per (tenant, contact, number). */
const NEW_INDEX = 'tenantId_1_contactId_1_whatsappPhoneNumberId_1';

/** As much of an index description as this migration needs to judge one. */
interface IndexShape {
  name?: string;
  key?: Record<string, unknown>;
  unique?: boolean;
}

/**
 * True for a unique index that says "this contact gets ONE conversation",
 * whatever else is in its key.
 *
 * Matched by shape rather than by name on purpose. The obvious one is
 * `tenantId_1_contactId_1`, but the database also carried
 * `tenantId_1_ownerUserId_1_contactId_1` from a schema version with an
 * owner field that no longer exists — every row has ownerUserId: null, so
 * that index enforced exactly the same "one chat per contact" rule, and
 * dropping the named one alone left inbound messages failing on it. A list
 * of names is a list of the stragglers someone remembered.
 *
 * An index that includes the number is the new constraint, or a narrower
 * one, and is left alone.
 */
function blocksPerNumberThreads(index: IndexShape): boolean {
  if (!index.unique) return false;
  const keys = Object.keys(index.key ?? {});
  return keys.includes('tenantId') && keys.includes('contactId') && !keys.includes('whatsappPhoneNumberId');
}

/**
 * Replaces every "one conversation per contact" unique index with the
 * per-number one.
 *
 * Mongoose cannot do this on its own: autoIndex creates the indexes a
 * schema declares but never drops ones it stopped declaring — including
 * ones declared by a schema version nobody in the codebase can see any
 * more. Those leftovers are precisely the constraint this change exists to
 * remove, so an inbound message to a second number fails with a
 * duplicate-key error on an index that does not appear in the code.
 *
 * Order matters. The new index is created first so uniqueness is never
 * unenforced in between; only then are the old ones dropped. Creating the
 * new one cannot fail on existing data: every current row is unique on
 * (tenant, contact) already, so it is unique on the superset too.
 *
 * Dropping them costs no lookups: (tenantId, contactId) is a prefix of the
 * new key, so the queries that used them — deleting a contact's chats, the
 * duplicate-contact merge — are served by the new index just as well.
 *
 * Idempotent — createIndex on an index that already exists is a no-op, and
 * a second run finds nothing left to drop.
 */
export async function migrateConversationNumberIndex(): Promise<void> {
  const collection = Conversation.collection;

  await collection.createIndex(
    { tenantId: 1, contactId: 1, whatsappPhoneNumberId: 1 },
    { unique: true, name: NEW_INDEX },
  );

  const indexes = (await collection.indexes()) as IndexShape[];
  const stale = indexes.filter((i) => i.name !== NEW_INDEX && blocksPerNumberThreads(i));

  if (stale.length === 0) {
    logger.debug('No one-conversation-per-contact index left to drop');
    return;
  }

  for (const index of stale) {
    if (!index.name) continue;
    await collection.dropIndex(index.name);
    logger.info(
      { index: index.name },
      'Dropped a one-conversation-per-contact unique index; chats are now per (contact, number)',
    );
  }
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
      'Conversation per-number index migration failed — an inbound message to a second WhatsApp number will fail with a duplicate-key error and never reach the inbox. Run `npm run migrate:conversation-number-index` against this database to retry.',
    );
  }
}
