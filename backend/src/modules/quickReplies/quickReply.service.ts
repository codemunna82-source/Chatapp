import { ApiError } from '../../lib/ApiError';
import * as repo from './quickReply.repository';
import type { QuickReplyDoc } from './quickReply.model';

export interface PublicQuickReply {
  id: string;
  title: string;
  body: string;
  useCount: number;
  createdAt: Date;
  updatedAt: Date;
}

function toPublicQuickReply(doc: QuickReplyDoc): PublicQuickReply {
  return {
    id: String(doc._id),
    title: doc.title,
    body: doc.body,
    useCount: doc.useCount,
    createdAt: doc.get('createdAt'),
    updatedAt: doc.get('updatedAt'),
  };
}

/** Mongo's duplicate-key error, which the unique (tenantId, title) index
 *  raises. Surfaced as a clear conflict rather than a 500. */
function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

export async function listQuickRepliesForTenant(tenantId: string): Promise<PublicQuickReply[]> {
  const docs = await repo.listQuickRepliesByTenant(tenantId);
  return docs.map(toPublicQuickReply);
}

export async function createQuickReplyForTenant(
  tenantId: string,
  createdByUserId: string,
  input: { title: string; body: string },
): Promise<PublicQuickReply> {
  try {
    const doc = await repo.createQuickReply({ tenantId, createdByUserId, ...input });
    return toPublicQuickReply(doc);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw ApiError.conflict('QUICK_REPLY_EXISTS', 'A saved reply with that title already exists.');
    }
    throw err;
  }
}

export async function updateQuickReplyForTenant(
  tenantId: string,
  id: string,
  updates: { title?: string; body?: string },
): Promise<PublicQuickReply> {
  try {
    const doc = await repo.updateQuickReply(id, tenantId, updates);
    if (!doc) throw ApiError.notFound('QUICK_REPLY_NOT_FOUND', 'That saved reply does not exist.');
    return toPublicQuickReply(doc);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw ApiError.conflict('QUICK_REPLY_EXISTS', 'A saved reply with that title already exists.');
    }
    throw err;
  }
}

export async function deleteQuickReplyForTenant(tenantId: string, id: string): Promise<void> {
  const doc = await repo.deleteQuickReply(id, tenantId);
  if (!doc) throw ApiError.notFound('QUICK_REPLY_NOT_FOUND', 'That saved reply does not exist.');
}

export async function recordQuickReplyUse(tenantId: string, id: string): Promise<void> {
  await repo.incrementQuickReplyUse(id, tenantId);
}
