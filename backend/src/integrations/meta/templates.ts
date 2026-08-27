import type { AxiosRequestConfig } from 'axios';
import { metaRequest, authConfig } from './metaClient';
import type { MetaTemplateSummary } from './types';

interface MetaTemplateListResponse {
  data: Array<{
    id: string;
    name: string;
    language: string;
    category: string;
    status: string;
    components: unknown;
  }>;
  paging?: { cursors?: { after?: string }; next?: string };
}

const MAX_PAGES = 20; // guard against an unbounded loop if Meta ever returns a cyclic `next`

export interface ListTemplatesCredentials {
  accessToken: string;
  wabaId: string;
}

/** Meta is the source of truth for templates — this only ever reads, never fabricates one. */
export async function listTemplates(creds: ListTemplatesCredentials): Promise<MetaTemplateSummary[]> {
  const results: MetaTemplateSummary[] = [];
  let after: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const config: AxiosRequestConfig = {
      ...authConfig(creds.accessToken),
      params: { limit: 100, ...(after ? { after } : {}) },
    };
    const res = await metaRequest<MetaTemplateListResponse>((client) =>
      client.get(`/${creds.wabaId}/message_templates`, config),
    );

    for (const t of res.data) {
      results.push({
        metaTemplateId: t.id,
        name: t.name,
        language: t.language,
        category: t.category as MetaTemplateSummary['category'],
        status: t.status as MetaTemplateSummary['status'],
        components: t.components,
      });
    }

    after = res.paging?.cursors?.after;
    if (!after || !res.paging?.next) break;
  }

  return results;
}
