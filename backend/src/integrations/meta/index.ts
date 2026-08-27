import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import * as messages from './messages';
import * as media from './media';
import { listTemplates } from './templates';
import { mockMetaGateway } from './mock/mockMetaGateway';
import type { MetaGateway } from './metaGateway';

const realMetaGateway: MetaGateway = {
  sendText: messages.sendText,
  sendTemplate: messages.sendTemplate,
  sendMedia: messages.sendMedia,
  sendReaction: messages.sendReaction,
  markAsRead: messages.markAsRead,
  uploadMedia: media.uploadMedia,
  retrieveMedia: media.retrieveMedia,
  downloadMediaBinary: media.downloadMediaBinary,
  listTemplates,
};

let warnedMockMode = false;

/**
 * The one place in the app that decides real-vs-mock (spec §39). Every
 * caller — outbound message service, template sync, media proxy — goes
 * through this rather than importing messages.ts/media.ts/templates.ts or
 * mockMetaGateway.ts directly.
 */
export function getMetaGateway(): MetaGateway {
  if (env.META_MOCK_MODE) {
    if (!warnedMockMode) {
      logger.warn('META_MOCK_MODE=true — using the mock Meta gateway. Never enable this in production.');
      warnedMockMode = true;
    }
    return mockMetaGateway;
  }
  return realMetaGateway;
}

export type { MetaGateway } from './metaGateway';
export type {
  MetaCredentials,
  MetaSendResult,
  SendTextMessageParams,
  SendTemplateMessageParams,
  SendMediaMessageParams,
  SendReactionParams,
  SendableMediaType,
  UploadMediaParams,
  UploadMediaResult,
  RetrieveMediaResult,
  MetaTemplateSummary,
} from './types';
export type { ListTemplatesCredentials } from './templates';
export { MetaApiError, toApiError as toMetaApiError } from './errors';
