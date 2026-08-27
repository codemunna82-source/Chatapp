import { getMetaGateway } from '../../integrations/meta';
import { resolveWabaCredentialsForTenant } from '../whatsapp/whatsapp.service';
import { upsertTemplate, listTemplatesByTenant } from './messageTemplate.repository';
import type { MessageTemplateDoc } from './messageTemplate.model';

/**
 * Pulls the current template list from Meta for one tenant's WABA and
 * mirrors it locally (spec §14) — Meta remains the source of truth for
 * approval status; we never fabricate or auto-approve a template here.
 */
export async function syncTemplatesFromMeta(
  tenantId: string,
  whatsappAccountId: string,
): Promise<MessageTemplateDoc[]> {
  const credentials = await resolveWabaCredentialsForTenant(tenantId, whatsappAccountId);
  const gateway = getMetaGateway();
  const metaTemplates = await gateway.listTemplates(credentials);

  const synced: MessageTemplateDoc[] = [];
  for (const t of metaTemplates) {
    const doc = await upsertTemplate({
      tenantId,
      name: t.name,
      language: t.language,
      category: t.category,
      status: t.status,
      metaTemplateId: t.metaTemplateId,
      components: t.components,
    });
    synced.push(doc);
  }
  return synced;
}

export async function listApprovedTemplates(tenantId: string): Promise<MessageTemplateDoc[]> {
  return listTemplatesByTenant(tenantId, 'APPROVED');
}
