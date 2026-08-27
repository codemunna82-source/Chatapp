import type {
  MetaCredentials,
  MetaSendResult,
  SendTextMessageParams,
  SendTemplateMessageParams,
  SendMediaMessageParams,
  UploadMediaParams,
  UploadMediaResult,
  RetrieveMediaResult,
  MetaTemplateSummary,
} from './types';
import type { ListTemplatesCredentials } from './templates';

/**
 * Unified surface the rest of the app calls — never `import` messages.ts /
 * media.ts / templates.ts directly outside this package. That keeps mock
 * mode a single, clearly-separated swap point (spec §39) rather than an
 * `if (mockMode)` scattered through business logic.
 */
export interface MetaGateway {
  sendText(creds: MetaCredentials, params: SendTextMessageParams): Promise<MetaSendResult>;
  sendTemplate(creds: MetaCredentials, params: SendTemplateMessageParams): Promise<MetaSendResult>;
  sendMedia(creds: MetaCredentials, params: SendMediaMessageParams): Promise<MetaSendResult>;
  markAsRead(creds: MetaCredentials, metaMessageId: string): Promise<void>;
  uploadMedia(creds: MetaCredentials, params: UploadMediaParams): Promise<UploadMediaResult>;
  retrieveMedia(creds: MetaCredentials, metaMediaId: string): Promise<RetrieveMediaResult>;
  downloadMediaBinary(creds: MetaCredentials, url: string): Promise<Buffer>;
  listTemplates(creds: ListTemplatesCredentials): Promise<MetaTemplateSummary[]>;
}
