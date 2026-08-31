import { randomUUID } from 'node:crypto';
import { logger } from '../../../lib/logger';
import type { MetaGateway } from '../metaGateway';

/**
 * Deterministic, network-free stand-in for the real Meta Cloud API — used
 * whenever META_MOCK_MODE=true (development/test only; spec §39 requires
 * this stay clearly separate from the production path, never silently
 * mixed in). Every call is logged with a MOCK prefix so it's unmistakable
 * in logs which mode a deployment is running in.
 */
export const mockMetaGateway: MetaGateway = {
  async sendText(_creds, params) {
    logger.debug({ to: params.to }, '[MOCK META] sendText');
    return { metaMessageId: `mock-wamid-${randomUUID()}` };
  },

  async sendTemplate(_creds, params) {
    logger.debug({ to: params.to, template: params.templateName }, '[MOCK META] sendTemplate');
    return { metaMessageId: `mock-wamid-${randomUUID()}` };
  },

  async sendMedia(_creds, params) {
    logger.debug({ to: params.to, mediaType: params.mediaType }, '[MOCK META] sendMedia');
    return { metaMessageId: `mock-wamid-${randomUUID()}` };
  },

  async sendReaction(_creds, params) {
    logger.debug({ to: params.to, reactToMetaMessageId: params.reactToMetaMessageId, emoji: params.emoji }, '[MOCK META] sendReaction');
    return { metaMessageId: `mock-wamid-${randomUUID()}` };
  },

  async markAsRead(_creds, metaMessageId) {
    logger.debug({ metaMessageId }, '[MOCK META] markAsRead');
  },

  async uploadMedia(_creds, params) {
    logger.debug({ mimeType: params.mimeType, size: params.buffer.length }, '[MOCK META] uploadMedia');
    return { metaMediaId: `mock-media-${randomUUID()}` };
  },

  async retrieveMedia(_creds, metaMediaId) {
    logger.debug({ metaMediaId }, '[MOCK META] retrieveMedia');
    return {
      metaMediaId,
      url: `https://mock-meta.local/media/${metaMediaId}`,
      mimeType: 'application/octet-stream',
      sha256: 'mock-sha256',
      fileSizeBytes: 1024,
    };
  },

  async downloadMediaBinary(_creds, url) {
    logger.debug({ url }, '[MOCK META] downloadMediaBinary');
    return Buffer.from(`mock-binary-content-for-${url}`);
  },

  async listTemplates(_creds) {
    logger.debug('[MOCK META] listTemplates');
    return [
      {
        metaTemplateId: 'mock-template-0001',
        name: 'order_ready_for_pickup',
        language: 'en_US',
        category: 'UTILITY',
        status: 'APPROVED',
        components: [{ type: 'BODY', text: 'Your order {{1}} is ready for pickup at {{2}}.' }],
      },
      {
        metaTemplateId: 'mock-template-0002',
        name: 'appointment_reminder',
        language: 'en_US',
        category: 'UTILITY',
        status: 'APPROVED',
        components: [{ type: 'BODY', text: 'Reminder: your appointment is on {{1}} at {{2}}.' }],
      },
    ];
  },
  async fetchPhoneNumberProfile(_accessToken, phoneNumberId) {
    logger.debug({ phoneNumberId }, '[MOCK META] fetchPhoneNumberProfile');
    // Accepts any id — mock mode exists precisely so a deployment without
    // real Meta credentials still works end to end.
    return { phoneNumberId, displayPhoneNumber: `+1 555 ${phoneNumberId.slice(-4)}`, verifiedName: 'Mock Business', qualityRating: 'GREEN' };
  },
  async preAcceptCall(_creds, callId) {
    logger.debug({ callId }, '[MOCK META] preAcceptCall');
  },

  async acceptCall(_creds, callId) {
    logger.debug({ callId }, '[MOCK META] acceptCall');
  },

  async rejectCall(_creds, callId) {
    logger.debug({ callId }, '[MOCK META] rejectCall');
  },

  async terminateCall(_creds, callId) {
    logger.debug({ callId }, '[MOCK META] terminateCall');
  },
  async getCallingSettings(_accessToken, phoneNumberId) {
    logger.debug({ phoneNumberId }, '[MOCK META] getCallingSettings');
    return { status: 'ENABLED', callIconVisibility: 'DEFAULT' };
  },

  async setCallingEnabled(_accessToken, phoneNumberId, enabled) {
    logger.debug({ phoneNumberId, enabled }, '[MOCK META] setCallingEnabled');
  },
};
