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

  const [contactsTotal, conversationStats, messageStats, messagesByDayRaw] = await Promise.all([
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

  return {
    contactsTotal,
    conversations,
    messages,
    messagesByDay,
  };
}
