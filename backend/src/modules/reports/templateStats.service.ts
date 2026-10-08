import { Types } from 'mongoose';
import { Message } from '../messages/message.model';
import { WhatsAppPhoneNumber } from '../whatsapp/whatsappPhoneNumber.model';
import { firstError } from '../messages/messageFailureReason';
import { createTtlCache } from '../../lib/ttlCache';

/**
 * How admins answer "is our template traffic healthy" without reading
 * Meta's own dashboard or grepping production logs — which template is
 * failing, how often, why, on which number, and whether a delivered one
 * is taking its time about it.
 *
 * MASTER_ADMIN only (see templateStats.routes.ts): a failure breakdown
 * names the exact reason Meta refused a send, which is diagnostic detail
 * for whoever manages the WhatsApp Business Account, not day-to-day
 * agent information.
 */

const DEFAULT_WINDOW_DAYS = 30;
/** How many of the most recent failures to read for the reason breakdown.
 *  A tenant whose templates are genuinely healthy never gets near this;
 *  one that is not should still get an answer in one request rather than
 *  scanning its entire failure history every time the page loads. */
const MAX_FAILURES_READ = 5000;

const STATS_TTL_MS = 30_000;
const statsCache = createTtlCache<TemplateStats>({ ttlMs: STATS_TTL_MS, maxEntries: 200 });

export interface TemplateFailureReason {
  reason: string;
  count: number;
}

export interface TemplateStatsRow {
  templateName: string;
  /** Every send counted once, whatever it ended up doing — delivered,
   *  failed, or still waiting on a status webhook. */
  total: number;
  delivered: number;
  failed: number;
  topFailureReasons: TemplateFailureReason[];
}

export interface TemplateStatsByNumber {
  whatsappPhoneNumberId: string;
  displayPhoneNumber: string;
  total: number;
  failed: number;
}

export interface TemplateStatsByDay {
  date: string;
  total: number;
  delivered: number;
  failed: number;
}

export interface TemplateStats {
  windowDays: number;
  /** Lifetime — every template this tenant has ever sent, not windowed.
   *  "How many have failed" is a question about the whole record, not
   *  just the recent window the trend chart covers. */
  totals: { total: number; delivered: number; failed: number };
  byTemplate: TemplateStatsRow[];
  byNumber: TemplateStatsByNumber[];
  /** Windowed to windowDays. */
  byDay: TemplateStatsByDay[];
  /**
   * Minutes from Meta accepting the send (sentAt) to the customer's
   * device confirming it (deliveredAt), across delivered templates in
   * the window. Median alongside mean for the same reason the main
   * dashboard's first-response time is: one slow outlier should not be
   * the number an admin acts on.
   */
  medianDeliveryMinutes: number | null;
  averageDeliveryMinutes: number | null;
}

/** Every outbound template this tenant has sent through Meta. Excludes
 *  the private web channel — a template routed there, if it ever is,
 *  never touches Meta's own delivery pipeline, so "failed" and "delivery
 *  time" mean nothing on it. */
function baseMatch(tenantId: Types.ObjectId): Record<string, unknown> {
  return { tenantId, type: 'template', direction: 'OUT', channel: 'whatsapp' };
}

/**
 * Three buckets, not the five raw statuses: QUEUED and SENT both just
 * mean "Meta has not told us the outcome yet", which a report has
 * nothing useful to say about beyond counting it in the total.
 */
function bucketOf(status: unknown): 'pending' | 'delivered' | 'failed' {
  if (status === 'FAILED') return 'failed';
  if (status === 'DELIVERED' || status === 'READ') return 'delivered';
  return 'pending';
}

function emptyTally(): { pending: number; delivered: number; failed: number } {
  return { pending: 0, delivered: 0, failed: 0 };
}

export async function getTemplateStats(
  tenantId: string,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<TemplateStats> {
  const cacheKey = `${tenantId}:${windowDays}`;
  const cached = statsCache.get(cacheKey);
  if (cached) return cached;

  const tenantObjectId = new Types.ObjectId(tenantId);
  const match = baseMatch(tenantObjectId);
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [byTemplateRaw, byNumberRaw, byDayRaw, latencyRaw, recentFailures] = await Promise.all([
    Message.aggregate<{ _id: { name: string | null; status: string }; count: number }>([
      { $match: match },
      { $group: { _id: { name: '$templateName', status: '$status' }, count: { $sum: 1 } } },
    ]),

    // Messages carry no number of their own — only their conversation
    // does — the same join the main dashboard uses for a scoped reader.
    Message.aggregate<{ _id: Types.ObjectId | null; total: number; failed: number }>([
      { $match: match },
      {
        $lookup: {
          from: 'conversations',
          localField: 'conversationId',
          foreignField: '_id',
          as: 'conversation',
        },
      },
      { $unwind: '$conversation' },
      {
        $group: {
          _id: '$conversation.whatsappPhoneNumberId',
          total: { $sum: 1 },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
        },
      },
    ]),

    Message.aggregate<{ _id: { day: string; status: string }; count: number }>([
      { $match: { ...match, createdAt: { $gte: since } } },
      {
        $group: {
          _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, status: '$status' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.day': 1 } },
    ]),

    Message.aggregate<{ minutes: number }>([
      { $match: { ...match, createdAt: { $gte: since }, sentAt: { $exists: true }, deliveredAt: { $exists: true } } },
      { $project: { minutes: { $divide: [{ $subtract: ['$deliveredAt', '$sentAt'] }, 60000] } } },
    ]),

    // The reason breakdown reads `error` — an untyped Mixed field holding
    // whatever shape Meta's webhook sent (see messageFailureReason.ts) —
    // which a Mongo aggregation cannot parse as defensively as the same
    // JS firstError() already does. Read lean and grouped here instead.
    Message.find({ ...match, status: 'FAILED' })
      .select('templateName error')
      .sort({ _id: -1 })
      .limit(MAX_FAILURES_READ)
      .lean(),
  ]);

  const tallyByTemplate = new Map<string, ReturnType<typeof emptyTally>>();
  const lifetimeTally = emptyTally();
  for (const row of byTemplateRaw) {
    const name = row._id.name ?? '(unnamed)';
    const tally = tallyByTemplate.get(name) ?? emptyTally();
    const bucket = bucketOf(row._id.status);
    tally[bucket] += row.count;
    lifetimeTally[bucket] += row.count;
    tallyByTemplate.set(name, tally);
  }

  const reasonsByTemplate = new Map<string, Map<string, number>>();
  for (const doc of recentFailures as unknown as { templateName?: string; error?: unknown }[]) {
    const name = doc.templateName ?? '(unnamed)';
    const reason = firstError(doc.error)?.title ?? 'Unknown reason';
    const byReason = reasonsByTemplate.get(name) ?? new Map<string, number>();
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    reasonsByTemplate.set(name, byReason);
  }

  const byTemplate: TemplateStatsRow[] = Array.from(tallyByTemplate.entries())
    .map(([templateName, tally]) => {
      const topFailureReasons = Array.from((reasonsByTemplate.get(templateName) ?? new Map()).entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      return {
        templateName,
        total: tally.pending + tally.delivered + tally.failed,
        delivered: tally.delivered,
        failed: tally.failed,
        topFailureReasons,
      };
    })
    .sort((a, b) => b.total - a.total);

  const numberIds = byNumberRaw.filter((r) => r._id).map((r) => r._id as Types.ObjectId);
  const numbers = numberIds.length
    ? await WhatsAppPhoneNumber.find({ _id: { $in: numberIds } }).select('displayPhoneNumber').lean()
    : [];
  const displayNameById = new Map(numbers.map((n) => [String(n._id), n.displayPhoneNumber]));
  const byNumber: TemplateStatsByNumber[] = byNumberRaw
    .filter((r) => r._id)
    .map((r) => ({
      whatsappPhoneNumberId: String(r._id),
      displayPhoneNumber: displayNameById.get(String(r._id)) ?? 'Unknown number',
      total: r.total,
      failed: r.failed,
    }))
    .sort((a, b) => b.total - a.total);

  const byDayMap = new Map<string, { pending: number; delivered: number; failed: number }>();
  for (let i = 0; i < windowDays; i += 1) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    byDayMap.set(d.toISOString().slice(0, 10), emptyTally());
  }
  for (const row of byDayRaw) {
    const tally = byDayMap.get(row._id.day);
    if (!tally) continue;
    tally[bucketOf(row._id.status)] += row.count;
  }
  const byDay: TemplateStatsByDay[] = Array.from(byDayMap.entries()).map(([date, tally]) => ({
    date,
    total: tally.pending + tally.delivered + tally.failed,
    delivered: tally.delivered,
    failed: tally.failed,
  }));

  // Computed in JS rather than with $median, the same reasoning the main
  // dashboard's first-response time uses: keeps working on MongoDB
  // versions that predate it, and the sample here is one row per
  // delivered template in the window — not worth a server-side sort.
  const minutes = latencyRaw.map((r) => r.minutes).sort((a, b) => a - b);
  const medianDeliveryMinutes =
    minutes.length === 0
      ? null
      : Math.round(
          minutes.length % 2 === 1
            ? minutes[(minutes.length - 1) / 2]!
            : (minutes[minutes.length / 2 - 1]! + minutes[minutes.length / 2]!) / 2,
        );
  const averageDeliveryMinutes =
    minutes.length === 0 ? null : Math.round(minutes.reduce((sum, m) => sum + m, 0) / minutes.length);

  const stats: TemplateStats = {
    windowDays,
    totals: {
      total: lifetimeTally.pending + lifetimeTally.delivered + lifetimeTally.failed,
      delivered: lifetimeTally.delivered,
      failed: lifetimeTally.failed,
    },
    byTemplate,
    byNumber,
    byDay,
    medianDeliveryMinutes,
    averageDeliveryMinutes,
  };
  statsCache.set(cacheKey, stats);
  return stats;
}

/** Exported for tests, which share one process across suites and would
 *  otherwise be able to read a previous test's numbers back out of it. */
export function resetTemplateStatsCache(): void {
  statsCache.clear();
}
