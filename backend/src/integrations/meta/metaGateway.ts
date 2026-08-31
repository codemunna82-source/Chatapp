import type {
  MetaCredentials,
  MetaSendResult,
  SendTextMessageParams,
  SendTemplateMessageParams,
  SendMediaMessageParams,
  SendReactionParams,
  UploadMediaParams,
  UploadMediaResult,
  RetrieveMediaResult,
  MetaTemplateSummary,
  PhoneNumberProfile,
} from './types';
import type { PhoneNumberCallingSettings } from './phoneNumbers';
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
  sendReaction(creds: MetaCredentials, params: SendReactionParams): Promise<MetaSendResult>;
  markAsRead(creds: MetaCredentials, metaMessageId: string): Promise<void>;
  uploadMedia(creds: MetaCredentials, params: UploadMediaParams): Promise<UploadMediaResult>;
  retrieveMedia(creds: MetaCredentials, metaMediaId: string): Promise<RetrieveMediaResult>;
  downloadMediaBinary(creds: MetaCredentials, url: string): Promise<Buffer>;
  listTemplates(creds: ListTemplatesCredentials): Promise<MetaTemplateSummary[]>;
  /**
   * WhatsApp Business Calling. The SDP strings pass straight through — the
   * media path is Meta ↔ the agent's device, never this server.
   */
  preAcceptCall(creds: MetaCredentials, callId: string, sdpAnswer: string): Promise<void>;
  acceptCall(creds: MetaCredentials, callId: string, sdpAnswer: string): Promise<void>;
  rejectCall(creds: MetaCredentials, callId: string): Promise<void>;
  terminateCall(creds: MetaCredentials, callId: string): Promise<void>;
  /** Calling is off by default on every number — these read and flip it. */
  getCallingSettings(accessToken: string, phoneNumberId: string): Promise<PhoneNumberCallingSettings>;
  setCallingEnabled(accessToken: string, phoneNumberId: string, enabled: boolean): Promise<void>;
  /** Verifies a phone_number_id exists and the token can reach it. */
  fetchPhoneNumberProfile(accessToken: string, phoneNumberId: string): Promise<PhoneNumberProfile>;
}
