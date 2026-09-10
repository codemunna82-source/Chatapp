import { Types } from 'mongoose';
import { GuestReport, type GuestReportDoc, type GuestReportLean, type GuestReportReason } from './guestReport.model';

export interface CreateGuestReportInput {
  tenantId: string;
  conversationId: string;
  contactId: string;
  guestSessionId: string;
  reason: GuestReportReason;
  details?: string;
  reportedMessageId?: string;
  reportedMessagePreview?: string;
  blocked: boolean;
}

export async function createGuestReport(input: CreateGuestReportInput): Promise<GuestReportDoc> {
  return GuestReport.create(input);
}

/**
 * How many reports this session has already filed today.
 *
 * The guest rate limiter counts requests per link and is generous enough
 * for a chat; it is not a defence against the same person filing the same
 * complaint two hundred times, which would bury every other report in the
 * workspace's queue. A daily ceiling per link leaves someone free to report
 * several genuinely different messages and stops a jammed button from
 * becoming a flood.
 */
export async function countRecentGuestReports(guestSessionId: string, since: Date): Promise<number> {
  if (!Types.ObjectId.isValid(guestSessionId)) return 0;
  return GuestReport.countDocuments({ guestSessionId, createdAt: { $gte: since } });
}

export async function listGuestReportsForConversation(
  tenantId: string,
  conversationId: string,
): Promise<GuestReportLean[]> {
  if (!Types.ObjectId.isValid(conversationId)) return [];
  return GuestReport.find({ tenantId, conversationId }).sort({ _id: -1 }).limit(50).lean<GuestReportLean[]>();
}
