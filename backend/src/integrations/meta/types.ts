/**
 * Credentials needed to call the Graph API on behalf of one tenant's
 * WhatsApp connection. `accessToken` is sensitive — never log it, never
 * send it to Android. See whatsapp.repository.ts for how these are
 * resolved from a WhatsAppAccount + WhatsAppPhoneNumber pair.
 */
export interface MetaCredentials {
  accessToken: string;
  phoneNumberId: string;
}

export interface MetaSendResult {
  metaMessageId: string;
}

export interface SendTextMessageParams {
  to: string; // E.164 phone number
  text: string;
  previewUrl?: boolean;
  replyToMetaMessageId?: string;
}

export interface SendTemplateComponent {
  type: 'header' | 'body' | 'button';
  parameters?: unknown[];
  sub_type?: string;
  index?: string;
}

export interface SendTemplateMessageParams {
  to: string;
  templateName: string;
  languageCode: string;
  components?: SendTemplateComponent[];
}

export type SendableMediaType = 'image' | 'video' | 'audio' | 'document';

export interface SendMediaMessageParams {
  to: string;
  mediaType: SendableMediaType;
  /** Exactly one of mediaId (already uploaded to Meta) or link (public HTTPS URL) must be set. */
  mediaId?: string;
  link?: string;
  caption?: string;
  filename?: string;
  replyToMetaMessageId?: string;
}

export interface SendReactionParams {
  to: string;
  /** The Meta wamid of the message being reacted to — not our own Message._id. */
  reactToMetaMessageId: string;
  /** A single emoji, or '' to remove a previously-sent reaction (both real, documented Meta behaviors). */
  emoji: string;
}

export interface UploadMediaParams {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
}

export interface UploadMediaResult {
  metaMediaId: string;
}

export interface RetrieveMediaResult {
  metaMediaId: string;
  url: string;
  mimeType: string;
  sha256: string;
  fileSizeBytes: number;
}

export interface MetaTemplateSummary {
  metaTemplateId: string;
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED';
  components: unknown;
}

/** One WhatsApp number's profile as Meta reports it. */
export interface PhoneNumberProfile {
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName?: string;
  qualityRating?: string;
}
