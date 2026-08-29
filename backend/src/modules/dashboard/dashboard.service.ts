import { Types } from 'mongoose';
import { Contact } from '../contacts/contact.model';
import { Conversation } from '../conversations/conversation.model';
import { Message } from '../messages/message.model';

const TIME_SERIES_DAYS = 14;

export interface DashboardSummary {
  contactsTotal: number;
  conversations: { open: number; archived: number; unreadTotal: number };
  messages: { sentTotal: number; receivedTotal: number; failedTotal: number };
  messagesByDay: { date: string; sent: number; received: number }[];
  /**
   * Today against yesterday. Counts alone say how much has happened ever,
   * which never changes what anyone does — a direction of travel does.
   */
  today: { sent: number; received: number; sentYesterday: number; receivedYesterday: number };
  /**
   * Median minutes from a customer's message to the first reply, over the
   * time-series window.
   *
   * Median, not mean: one chat left overnight drags an average into
   * uselessness while the typical reply was two minutes. Null when there is
   * nothing to measure — an honest gap rather than a fabricated zero, which
   * would read as instant replies.
   */
  medianFirstResponseMinutes: number | null;
  /** Busiest contacts by message volume in the window. */
  topContacts: { contactId: string; name?: string; phone: string; messages: number }[];
}

/**
 * Every aggregation `$match`es on tenantId first (spec §7) so Mongo can use
 * the tenant-prefixed compound indexes already on these collections before
 * any grouping/sorting work happens.
 *
 * Deliberately excludes wallet balance and subscription plan/status: those
 * are MASTER_ADMIN-only (see wallet.routes.ts/subscription.routes.ts), but
 * this endpoint is reachable by any SUB_USER holding ANALYTICS_VIEW — an
 * embedded copy here would silently widen who can see tenant billing data.
 * The mobile dashboard screen fetches those separately, gated by role.
 */
export async function getDashboardSummary(tenantId: string): Promise<DashboardSummary> {
  const tenantObjectId = new Types.ObjectId(tenantId);
  const since = new Date(Date.now() - TIME_SERIES_DAYS * 24 * 60 * 60 * 1000);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);

  const [contactsTotal, conversationStats, messageStats, messagesByDayRaw, todayRaw, responseRaw, topContactsRaw] =
    await Promise.all([
    Contact.countDocuments({ tenantId: tenantObjectId }),
    Conversation.aggregate<{ _id: string; count: number; unread: number }>([
      { $match: { tenantId: tenantObjectId } },
      { $group: { _id: '$status', count: { $sum: 1 }, unread: { $sum: '$unreadCount' } } },
    ]),
    Message.aggregate<{ _id: { direction: string; failed: boolean }; count: number }>([
      { $match: { tenantId: tenantObjectId } },
      { $group: { _id: { direction: '$direction', failed: { $eq: ['$status', 'FAILED'] } }, count: { $sum: 1 } } },
    ]),
    Message.aggregate<{ _id: { day: string; direction: string }; count: number }>([
      { $match: { tenantId: tenantObjectId, createdAt: { $gte: since } } },
      {
        $group: {
          _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, direction: '$direction' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.day': 1 } },
    ]),

    // Today and yesterday in one pass — two round trips for two adjacent
    // buckets would be the same query twice.
    Message.aggregate<{ _id: { day: string; direction: string }; count: number }>([
      { $match: { tenantId: tenantObjectId, createdAt: { $gte: startOfYesterday } } },
      {
        $group: {
          _id: {
            day: { $cond: [{ $gte: ['$createdAt', startOfToday] }, 'today', 'yesterday'] },
            direction: '$direction',
          },
          count: { $sum: 1 },
        },
      },
    ]),

    // First response per conversation: the earliest outbound that came
    // AFTER the conversation's most recent inbound. Restricted to the
    // window so a long-dead chat cannot skew the current picture.
    Message.aggregate<{ minutes: number }>([
      { $match: { tenantId: tenantObjectId, createdAt: { $gte: since } } },
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: '$conversationId',
          firstInbound: { $min: { $cond: [{ $eq: ['$direction', 'IN'] }, '$createdAt', null] } },
          firstOutbound: { $min: { $cond: [{ $eq: ['$direction', 'OUT'] }, '$createdAt', null] } },
        },
      },
      // Both present, and the reply actually came after the question —
      // an outbound-first conversation is us starting it, not a response.
      { $match: { firstInbound: { $ne: null }, firstOutbound: { $ne: null }, $expr: { $gt: ['$firstOutbound', '$firstInbound'] } } },
      {
        $project: {
          minutes: { $divide: [{ $subtract: ['$firstOutbound', '$firstInbound'] }, 60000] },
        },
      },
    ]),

    Message.aggregate<{ _id: Types.ObjectId; messages: number }>([
      { $match: { tenantId: tenantObjectId, createdAt: { $gte: since } } },
      { $group: { _id: '$conversationId', messages: { $sum: 1 } } },
      { $sort: { messages: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'conversations',
          localField: '_id',
          foreignField: '_id',
          as: 'conversation',
        },
      },
      { $unwind: '$conversation' },
      {
        $lookup: {
          from: 'contacts',
          localField: 'conversation.contactId',
          foreignField: '_id',
          as: 'contact',
        },
      },
      { $unwind: '$contact' },
      { $project: { messages: 1, name: '$contact.name', phone: '$contact.phone', contactId: '$contact._id' } },
    ]),
  ]);

  const conversations = { open: 0, archived: 0, unreadTotal: 0 };
  for (const row of conversationStats) {
    if (row._id === 'OPEN') conversations.open = row.count;
    else if (row._id === 'ARCHIVED') conversations.archived = row.count;
    conversations.unreadTotal += row.unread;
  }

  const messages = { sentTotal: 0, receivedTotal: 0, failedTotal: 0 };
  for (const row of messageStats) {
    if (row._id.failed) messages.failedTotal += row.count;
    else if (row._id.direction === 'OUT') messages.sentTotal += row.count;
    else if (row._id.direction === 'IN') messages.receivedTotal += row.count;
  }

  const byDay = new Map<string, { sent: number; received: number }>();
  for (let i = 0; i < TIME_SERIES_DAYS; i += 1) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    byDay.set(d.toISOString().slice(0, 10), { sent: 0, received: 0 });
  }
  for (const row of messagesByDayRaw) {
    const bucket = byDay.get(row._id.day);
    if (!bucket) continue;
    if (row._id.direction === 'OUT') bucket.sent += row.count;
    else if (row._id.direction === 'IN') bucket.received += row.count;
  }
  const messagesByDay = Array.from(byDay.entries()).map(([date, v]) => ({ date, ...v }));

  const today = { sent: 0, received: 0, sentYesterday: 0, receivedYesterday: 0 };
  for (const row of todayRaw) {
    const isToday = row._id.day === 'today';
    if (row._id.direction === 'OUT') {
      if (isToday) today.sent += row.count;
      else today.sentYesterday += row.count;
    } else if (row._id.direction === 'IN') {
      if (isToday) today.received += row.count;
      else today.receivedYesterday += row.count;
    }
  }

  // Computed here rather than with $median so this keeps working on the
  // MongoDB versions that predate it — the sample is one row per
  // conversation in the window, not something worth a server-side sort.
  const responseTimes = responseRaw.map((r) => r.minutes).sort((a, b) => a - b);
  const medianFirstResponseMinutes =
    responseTimes.length === 0
      ? null
      : Math.round(
          responseTimes.length % 2 === 1
            ? responseTimes[(responseTimes.length - 1) / 2]!
            : (responseTimes[responseTimes.length / 2 - 1]! + responseTimes[responseTimes.length / 2]!) / 2,
        );

  const topContacts = (topContactsRaw as unknown as {
    contactId: Types.ObjectId;
    name?: string;
    phone: string;
    messages: number;
  }[]).map((row) => ({
    contactId: String(row.contactId),
    name: row.name ?? undefined,
    phone: row.phone,
    messages: row.messages,
  }));

  return {
    today,
    medianFirstResponseMinutes,
    topContacts,
    contactsTotal,
    conversations,
    messages,
    messagesByDay,
  };
}
