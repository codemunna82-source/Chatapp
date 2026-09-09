import { logger } from '../../lib/logger';
import { normalizePhone } from '../../lib/phone';
import { Contact, type ContactLean } from './contact.model';
import { Conversation } from '../conversations/conversation.model';
import { Message } from '../messages/message.model';
import { CallLog } from '../calls/callLog.model';
import { GuestSession } from '../guest/guestSession.model';

/**
 * Repairs customers who exist twice.
 *
 * Two paths created contacts and disagreed about format: the REST API
 * wrote E.164 with a leading `+`, Meta's webhook wrote the bare digits it
 * sends. With a unique index on the exact string that made one person two
 * contacts, two conversations, and a web chat that never appeared in the
 * thread the agent was reading. Lookups now match every stored form
 * (see lib/phone.ts), so nothing new splits — but rows already split do
 * not heal themselves, and this is what joins them back up.
 *
 * Everything below is idempotent: a second run over a merged database
 * finds no groups and changes nothing.
 */

export interface MergeReport {
  groupsFound: number;
  contactsMerged: number;
  conversationsMerged: number;
  messagesMoved: number;
  callsMoved: number;
  guestSessionsMoved: number;
  /** Human-readable, for the dry run — one line per group. */
  details: string[];
}

/**
 * Groups contacts that are the same number written differently.
 *
 * Pure and exported for its own sake: this is the judgement the whole
 * migration rests on, and it is far easier to be sure of here than
 * against a database.
 */
export function groupByNormalizedPhone(contacts: ContactLean[]): ContactLean[][] {
  const groups = new Map<string, ContactLean[]>();

  for (const contact of contacts) {
    // Falls back to the raw string so an unparseable number groups only
    // with an identical one, rather than with every other bad value.
    const key = normalizePhone(contact.phone) ?? `raw:${contact.phone}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(contact);
    else groups.set(key, [contact]);
  }

  return [...groups.values()].filter((group) => group.length > 1);
}

/**
 * Which row of a group to keep.
 *
 * The oldest wins, because ObjectId order is insertion order and the
 * oldest contact is the one the workspace's history hangs off — its
 * conversation is the thread the agent has been reading. Format is not the
 * tiebreak: keeping the prettier phone string but discarding the older
 * thread would be optimising the wrong thing. The survivor's number is
 * rewritten to canonical form afterwards either way.
 */
export function chooseSurvivor(group: ContactLean[]): ContactLean {
  return [...group].sort((a, b) => String(a._id).localeCompare(String(b._id)))[0]!;
}

/** Merges one group in place. Returns the counts it contributed. */
async function mergeGroup(group: ContactLean[]): Promise<Omit<MergeReport, 'groupsFound' | 'details'>> {
  const survivor = chooseSurvivor(group);
  const survivorId = String(survivor._id);
  const tenantId = String(survivor.tenantId);
  const duplicates = group.filter((c) => String(c._id) !== survivorId);

  const counts = {
    contactsMerged: 0,
    conversationsMerged: 0,
    messagesMoved: 0,
    callsMoved: 0,
    guestSessionsMoved: 0,
  };

  const survivorConversation = await Conversation.findOne({ tenantId, contactId: survivorId });

  for (const duplicate of duplicates) {
    const duplicateId = String(duplicate._id);

    const duplicateConversation = await Conversation.findOne({ tenantId, contactId: duplicateId });
    if (duplicateConversation) {
      if (survivorConversation) {
        // Both sides have a thread, so the messages move rather than the
        // conversation — the unique (tenant, contact) index means the
        // survivor cannot simply acquire a second one.
        const moved = await Message.updateMany(
          { tenantId, conversationId: duplicateConversation._id },
          { $set: { conversationId: survivorConversation._id } },
        );
        counts.messagesMoved += moved.modifiedCount;

        await GuestSession.updateMany(
          { tenantId, conversationId: duplicateConversation._id },
          { $set: { conversationId: survivorConversation._id, contactId: survivorId } },
        );
        await CallLog.updateMany(
          { tenantId, conversationId: duplicateConversation._id },
          { $set: { conversationId: survivorConversation._id } },
        );

        // Unread counts add up; a customer's unread messages did not stop
        // being unread by arriving under a second contact row.
        survivorConversation.unreadCount =
          (survivorConversation.unreadCount ?? 0) + (duplicateConversation.unreadCount ?? 0);
        await Conversation.deleteOne({ _id: duplicateConversation._id });
        counts.conversationsMerged += 1;
      } else {
        // Nothing to merge into — the thread simply changes owner.
        duplicateConversation.contactId = survivor._id;
        await duplicateConversation.save();
      }
    }

    await CallLog.updateMany({ tenantId, contactId: duplicateId }, { $set: { contactId: survivorId } })
      .then((r) => {
        counts.callsMoved += r.modifiedCount;
      });
    await GuestSession.updateMany({ tenantId, contactId: duplicateId }, { $set: { contactId: survivorId } })
      .then((r) => {
        counts.guestSessionsMoved += r.modifiedCount;
      });

    // Fields the survivor is missing but the duplicate has. A name or an
    // avatar someone took the trouble to set should not be lost because
    // they set it on the row that happened to lose.
    const patch: Record<string, unknown> = {};
    if (!survivor.name && duplicate.name) patch.name = duplicate.name;
    const mergedTags = [...new Set([...(survivor.tags ?? []), ...(duplicate.tags ?? [])])];
    if (mergedTags.length > (survivor.tags?.length ?? 0)) patch.tags = mergedTags;
    if (Object.keys(patch).length > 0) {
      await Contact.updateOne({ _id: survivorId }, { $set: patch });
    }

    await Contact.deleteOne({ _id: duplicateId });
    counts.contactsMerged += 1;
  }

  // Last, and only now: the survivor's number takes canonical form, so a
  // re-run cannot see this group again.
  const canonical = normalizePhone(survivor.phone);
  if (canonical && canonical !== survivor.phone) {
    await Contact.updateOne({ _id: survivorId }, { $set: { phone: canonical } });
  }

  if (survivorConversation) await survivorConversation.save();
  return counts;
}

/**
 * Finds and (unless dryRun) merges every duplicate in every tenant.
 *
 * Defaults to a dry run. This rewrites conversation ownership across a
 * live inbox, and "show me what you would do" should never require
 * remembering a flag.
 */
export async function mergeDuplicateContacts(opts: { dryRun?: boolean } = {}): Promise<MergeReport> {
  const dryRun = opts.dryRun ?? true;
  const report: MergeReport = {
    groupsFound: 0,
    contactsMerged: 0,
    conversationsMerged: 0,
    messagesMoved: 0,
    callsMoved: 0,
    guestSessionsMoved: 0,
    details: [],
  };

  const tenantIds = await Contact.distinct('tenantId');

  for (const tenantId of tenantIds) {
    const contacts = await Contact.find({ tenantId }).lean<ContactLean[]>();
    const groups = groupByNormalizedPhone(contacts);

    for (const group of groups) {
      report.groupsFound += 1;
      const survivor = chooseSurvivor(group);
      const losers = group.filter((c) => String(c._id) !== String(survivor._id));
      report.details.push(
        `${normalizePhone(survivor.phone) ?? survivor.phone}: keeping ${String(survivor._id)}` +
          ` (${survivor.phone}), merging ${losers.map((c) => `${String(c._id)} (${c.phone})`).join(', ')}`,
      );

      if (dryRun) continue;

      const counts = await mergeGroup(group);
      report.contactsMerged += counts.contactsMerged;
      report.conversationsMerged += counts.conversationsMerged;
      report.messagesMoved += counts.messagesMoved;
      report.callsMoved += counts.callsMoved;
      report.guestSessionsMoved += counts.guestSessionsMoved;
    }
  }

  logger.info({ ...report, details: undefined, dryRun }, 'Duplicate contact merge complete');
  return report;
}
