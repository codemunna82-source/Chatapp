import { Types } from 'mongoose';
import { MessageTemplate, type MessageTemplateDoc, type TemplateStatus } from './messageTemplate.model';

export interface UpsertTemplateInput {
  tenantId: string;
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  status?: TemplateStatus;
  components: unknown;
  metaTemplateId?: string;
}

/** Meta is the source of truth for templates — this upserts our local mirror of it. */
export async function upsertTemplate(input: UpsertTemplateInput): Promise<MessageTemplateDoc> {
  return MessageTemplate.findOneAndUpdate(
    { tenantId: input.tenantId, name: input.name, language: input.language },
    { $set: input },
    { new: true, upsert: true },
  );
}

export async function listTemplatesByTenant(
  tenantId: string,
  status?: TemplateStatus,
): Promise<MessageTemplateDoc[]> {
  const filter: Record<string, unknown> = { tenantId };
  if (status) filter.status = status;
  return MessageTemplate.find(filter).sort({ name: 1 });
}

export async function findTemplateByIdAndTenant(id: string, tenantId: string): Promise<MessageTemplateDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return MessageTemplate.findOne({ _id: id, tenantId });
}
