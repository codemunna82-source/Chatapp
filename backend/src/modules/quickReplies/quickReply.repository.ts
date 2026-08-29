import { Types } from 'mongoose';
import { QuickReply, type QuickReplyDoc } from './quickReply.model';

export interface CreateQuickReplyInput {
  tenantId: string;
  title: string;
  body: string;
  createdByUserId?: string;
}

export async function createQuickReply(input: CreateQuickReplyInput): Promise<QuickReplyDoc> {
  return QuickReply.create(input);
}

/** Most-used first — see the model's useCount note. */
export async function listQuickRepliesByTenant(tenantId: string): Promise<QuickReplyDoc[]> {
  // No pagination: this is a hand-curated list an agent scrolls in a sheet.
  // A workspace with hundreds of saved replies has a different problem than
  // one a cursor would solve, and the cap keeps a runaway list from ever
  // being an unbounded response.
  return QuickReply.find({ tenantId }).sort({ useCount: -1, title: 1 }).limit(200);
}

export async function findQuickReplyByIdAndTenant(id: string, tenantId: string): Promise<QuickReplyDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return QuickReply.findOne({ _id: id, tenantId });
}

export async function updateQuickReply(
  id: string,
  tenantId: string,
  updates: { title?: string; body?: string },
): Promise<QuickReplyDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return QuickReply.findOneAndUpdate({ _id: id, tenantId }, { $set: updates }, { new: true });
}

export async function deleteQuickReply(id: string, tenantId: string): Promise<QuickReplyDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return QuickReply.findOneAndDelete({ _id: id, tenantId });
}

/** Fire-and-forget from the caller's perspective: a failed counter bump must
 *  never stop the message it was counting from being sent. */
export async function incrementQuickReplyUse(id: string, tenantId: string): Promise<void> {
  if (!Types.ObjectId.isValid(id)) return;
  await QuickReply.updateOne({ _id: id, tenantId }, { $inc: { useCount: 1 } });
}
