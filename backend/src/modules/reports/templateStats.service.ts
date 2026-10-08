import { Types } from 'mongoose';
import { Message } from '../messages/message.model';
import { Conversation } from '../conversations/conversation.model';
import { WhatsAppPhoneNumber } from '../whatsapp/whatsappPhoneNumber.model';
import { firstError } from '../messages/messageFailureReason';
import { createTtlCache } from '../../lib/ttlCache';

/**
 * How admins answer "is our template traffic healthy" without reading
 * Meta's own dashboard or grepping production logs — which template is
 * failing, how often, why, on which number, and whether a delivered one
 * is taking its time about it. Scopable to one WhatsApp number, the same
 * drill-down the main dashboard offers a reader limited to one.
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
/**
 * How many un-named rows to read and back-fill a name for in JS.
 *
 * `templateName` is a real field now, but every template message sent
 * before that existed has none — only the display text "Template: X" it
 * was always written with. This population only shrinks: every new
 * template send already carries the field, so there is nothing recurring
 * here to outgrow a single bounded read.
 */
const MAX_LEGACY_READ = 20_000;
/** `text` for a template send is always exactly "Template: <name>" — see
 *  message.service.ts. Its own length, so the name starts right after it. */
const LEGACY_TEXT_PREFIX = 'Template: ';

const STATS_TTL_MS = 30_000;
const statsCache = createTtlCache<TemplateStats>({ ttlMs: STATS_TTL_MS, maxEntries: 500 });

export interface TemplateFailureReason {
  reason: string;
  count: number;
}

export interface TemplateStatsRow {
  templateName: string;
  /** Every send counted once, whatever it ended up doing — delivered,
   *  failed, or still waiting on a status webhook. automatic + agent. */
  total: number;
  delivered: number;
  failed: number;
  /** Sent by the system — the automatic private-chat invitation
   *  (guestAutoReply.service.ts), the only thing that ever writes
   *  `internal: true`. Configured on the Automatic Replies page, not
   *  picked per-send by an agent. */
  automatic: MessageTally;
  /** Picked by an agent from the template list, per conversation. */
  agent: MessageTally;
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

export interface MessageVolumeByDay {
  date: string;
  /** From the customer. */
  in: number;
  /** From this workspace — template, plain text, media, everything. */
  out: number;
}

export interface MessageTally {
  total: number;
  delivered: number;
  failed: number;
}

export interface TemplateStats {
  windowDays: number;
  /** The number this report is scoped to, or undefined for the whole workspace. */
  whatsappPhoneNumberId?: string;
  /** Lifetime — every template this tenant (or this number) has ever
   *  sent, not windowed. "How many have failed" is a question about the
   *  whole record, not just the recent window the trend chart covers. */
  totals: MessageTally;
  /** The same lifetime shape for plain (non-template) outbound WhatsApp
   *  text — the other half of "what did this number actually send". */
  plainTotals: MessageTally;
  byTemplate: TemplateStatsRow[];
  /** Only computed for the whole-workspace view — scoped to one number
   *  this is necessarily that number's own single row, which the caller
   *  already has in `totals`. */
  byNumber: TemplateStatsByNumber[];
  /** Windowed to windowDays. */
  byDay: TemplateStatsByDay[];
  /**
   * The whole WhatsApp conversation, both directions, every message
   * type — not just templates. "How many messages came in and went out
   * today, on this number" is a different question from "is our
   * template traffic healthy", and the by-template/by-day figures above
   * can't answer it: those are OUT-only and template-only by design.
   * Windowed to windowDays.
   */
  messagesByDay: MessageVolumeByDay[];
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

function toMessageTally(t: ReturnType<typeof emptyTally>): MessageTally {
  return { total: t.pending + t.delivered + t.failed, delivered: t.delivered, failed: t.failed };
}

/** The approved template's name, from the real field when a send has one
 *  and from its display text when it predates that field. Never null for
 *  an actual template send — every one of them was written with this
 *  exact prefix. */
function resolveTemplateName(doc: { templateName?: string | null; text?: string | null }): string {
  if (doc.templateName) return doc.templateName;
  if (doc.text?.startsWith(LEGACY_TEXT_PREFIX)) return doc.text.slice(LEGACY_TEXT_PREFIX.length);
  return '(unnamed)';
}

export async function getTemplateStats(
  tenantId: string,
  windowDays: number = DEFAULT_WINDOW_DAYS,
  whatsappPhoneNumberId?: string,
): Promise<TemplateStats> {
  const cacheKey = `${tenantId}:${windowDays}:${whatsappPhoneNumberId ?? 'all'}`;
  const cached = statsCache.get(cacheKey);
  if (cached) return cached;

  const tenantObjectId = new Types.ObjectId(tenantId);
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // Messages carry no number of their own — only their conversation does.
  // Scoping to one number means scoping to that number's conversations
  // first, the same join the main dashboard uses for a limited reader.
  let conversationScope: Record<string, unknown> = {};
  if (whatsappPhoneNumberId) {
    const scoped = await Conversation.find({
      tenantId: tenantObjectId,
      whatsappPhoneNumberId: new Types.ObjectId(whatsappPhoneNumberId),
    })
      .select('_id')
      .lean();
    conversationScope = { conversationId: { $in: scoped.map((c) => c._id) } };
  }

  const templateMatch = { tenantId: tenantObjectId, type: 'template', direction: 'OUT', channel: 'whatsapp', ...conversationScope };
  const namedMatch = { ...templateMatch, templateName: { $exists: true, $ne: null } };
  const unnamedMatch = { ...templateMatch, $or: [{ templateName: { $exists: false } }, { templateName: null }] };
  // "Plain" — an ordinary WhatsApp text, never a template, same wire and
  // same scope. The other half of what a number actually sent.
  const plainMatch = { tenantId: tenantObjectId, type: 'text', direction: 'OUT', channel: 'whatsapp', ...conversationScope };

  const [namedRaw, unnamedRows, byNumberRaw, byDayRaw, latencyRaw, recentFailures, plainRaw, volumeByDayRaw] =
    await Promise.all([
    Message.aggregate<{ _id: { name: string; status: string; internal: boolean }; count: number }>([
      { $match: namedMatch },
      {
        $group: {
          _id: { name: '$templateName', status: '$status', internal: { $ifNull: ['$internal', false] } },
          count: { $sum: 1 },
        },
      },
    ]),

    // Bounded, JS-side: see MAX_LEGACY_READ.
    Message.find(unnamedMatch).select('text status internal').sort({ _id: -1 }).limit(MAX_LEGACY_READ).lean(),

    // Only meaningful for the whole-workspace view — scoped to one
    // number this still runs but produces exactly that number's row,
    // which `totals` already carries; cheap enough not to special-case.
    Message.aggregate<{ _id: Types.ObjectId | null; total: number; failed: number }>([
      { $match: templateMatch },
      { $lookup: { from: 'conversations', localField: 'conversationId', foreignField: '_id', as: 'conversation' } },
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
      { $match: { ...templateMatch, createdAt: { $gte: since } } },
      {
        $group: {
          _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, status: '$status' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.day': 1 } },
    ]),

    Message.aggregate<{ minutes: number }>([
      {
        $match: {
          ...templateMatch,
          createdAt: { $gte: since },
          sentAt: { $exists: true },
          deliveredAt: { $exists: true },
        },
      },
      { $project: { minutes: { $divide: [{ $subtract: ['$deliveredAt', '$sentAt'] }, 60000] } } },
    ]),

    // The reason breakdown reads `error` — an untyped Mixed field holding
    // whatever shape Meta's webhook sent (see messageFailureReason.ts) —
    // which a Mongo aggregation cannot parse as defensively as the same
    // JS firstError() already does. Read lean and grouped here instead.
    Message.find({ ...templateMatch, status: 'FAILED' })
      .select('templateName text error')
      .sort({ _id: -1 })
      .limit(MAX_FAILURES_READ)
      .lean(),

    Message.aggregate<{ _id: string; count: number }>([
      { $match: plainMatch },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),

    // Every message, both directions — the whole WhatsApp conversation on
    // this scope, not just what this workspace sent. channel: 'whatsapp'
    // only: a reply routed to the private web window never touches Meta
    // and is not part of "how much did this number talk to Meta today".
    Message.aggregate<{ _id: { day: string; direction: string }; count: number }>([
      {
        $match: {
          tenantId: tenantObjectId,
          channel: 'whatsapp',
          createdAt: { $gte: since },
          ...conversationScope,
        },
      },
      {
        $group: {
          _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, direction: '$direction' },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  // Per template, two tallies rather than one: `internal` (set only by
  // the automatic private-chat invitation) is the one bit that tells a
  // system send apart from one an agent picked, and the admin asking
  // "how many of this template went out" needs to know which is which —
  // a number configured on the Automatic Replies page reads very
  // differently from the same number run up by agents individually.
  const tallyByTemplate = new Map<string, { automatic: ReturnType<typeof emptyTally>; agent: ReturnType<typeof emptyTally> }>();
  const lifetimeTally = emptyTally();

  function addToTally(name: string, internal: boolean, status: unknown, count: number): void {
    const entry = tallyByTemplate.get(name) ?? { automatic: emptyTally(), agent: emptyTally() };
    const bucket = bucketOf(status);
    entry[internal ? 'automatic' : 'agent'][bucket] += count;
    tallyByTemplate.set(name, entry);
    lifetimeTally[bucket] += count;
  }

  for (const row of namedRaw) {
    addToTally(row._id.name, row._id.internal, row._id.status, row.count);
  }
  for (const doc of unnamedRows as unknown as { text?: string; status?: string; internal?: boolean }[]) {
    addToTally(resolveTemplateName({ text: doc.text }), Boolean(doc.internal), doc.status, 1);
  }

  const reasonsByTemplate = new Map<string, Map<string, number>>();
  for (const doc of recentFailures as unknown as { templateName?: string; text?: string; error?: unknown }[]) {
    const name = resolveTemplateName(doc);
    const reason = firstError(doc.error)?.title ?? 'Unknown reason';
    const byReason = reasonsByTemplate.get(name) ?? new Map<string, number>();
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    reasonsByTemplate.set(name, byReason);
  }

  const byTemplate: TemplateStatsRow[] = Array.from(tallyByTemplate.entries())
    .map(([templateName, { automatic, agent }]) => {
      const topFailureReasons = Array.from((reasonsByTemplate.get(templateName) ?? new Map()).entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      const automaticTally = toMessageTally(automatic);
      const agentTally = toMessageTally(agent);
      return {
        templateName,
        total: automaticTally.total + agentTally.total,
        delivered: automaticTally.delivered + agentTally.delivered,
        failed: automaticTally.failed + agentTally.failed,
        automatic: automaticTally,
        agent: agentTally,
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
    ...toMessageTally(tally),
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

  const plainTally = emptyTally();
  for (const row of plainRaw) {
    plainTally[bucketOf(row._id)] += row.count;
  }

  const volumeByDayMap = new Map<string, { in: number; out: number }>();
  for (let i = 0; i < windowDays; i += 1) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    volumeByDayMap.set(d.toISOString().slice(0, 10), { in: 0, out: 0 });
  }
  for (const row of volumeByDayRaw) {
    const bucket = volumeByDayMap.get(row._id.day);
    if (!bucket) continue;
    if (row._id.direction === 'IN') bucket.in += row.count;
    else if (row._id.direction === 'OUT') bucket.out += row.count;
  }
  const messagesByDay: MessageVolumeByDay[] = Array.from(volumeByDayMap.entries()).map(([date, v]) => ({
    date,
    ...v,
  }));

  const stats: TemplateStats = {
    windowDays,
    whatsappPhoneNumberId,
    totals: toMessageTally(lifetimeTally),
    plainTotals: toMessageTally(plainTally),
    byTemplate,
    byNumber,
    byDay,
    messagesByDay,
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
