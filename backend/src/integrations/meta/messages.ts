import { metaRequest, authConfig } from './metaClient';
import type {
  MetaCredentials,
  MetaSendResult,
  SendTextMessageParams,
  SendTemplateMessageParams,
  SendMediaMessageParams,
  SendReactionParams,
} from './types';

interface MetaSendResponse {
  messaging_product: 'whatsapp';
  contacts: { input: string; wa_id: string }[];
  messages: { id: string }[];
}

function extractResult(res: MetaSendResponse): MetaSendResult {
  const id = res.messages?.[0]?.id;
  if (!id) {
    throw new Error('Meta send response did not include a message id');
  }
  return { metaMessageId: id };
}

export async function sendText(creds: MetaCredentials, params: SendTextMessageParams): Promise<MetaSendResult> {
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: params.to,
    type: 'text',
    text: { body: params.text, preview_url: params.previewUrl ?? false },
    ...(params.replyToMetaMessageId ? { context: { message_id: params.replyToMetaMessageId } } : {}),
  };
  const res = await metaRequest<MetaSendResponse>((client) =>
    client.post(`/${creds.phoneNumberId}/messages`, body, authConfig(creds.accessToken)),
  );
  return extractResult(res);
}

export async function sendTemplate(
  creds: MetaCredentials,
  params: SendTemplateMessageParams,
): Promise<MetaSendResult> {
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: params.to,
    type: 'template',
    template: {
      name: params.templateName,
      language: { code: params.languageCode },
      ...(params.components ? { components: params.components } : {}),
    },
  };
  const res = await metaRequest<MetaSendResponse>((client) =>
    client.post(`/${creds.phoneNumberId}/messages`, body, authConfig(creds.accessToken)),
  );
  return extractResult(res);
}

export async function sendMedia(creds: MetaCredentials, params: SendMediaMessageParams): Promise<MetaSendResult> {
  if (!params.mediaId && !params.link) {
    throw new Error('sendMedia requires either mediaId or link');
  }
  const mediaNode: Record<string, unknown> = params.mediaId ? { id: params.mediaId } : { link: params.link };
  if (params.caption) mediaNode.caption = params.caption;
  if (params.filename && params.mediaType === 'document') mediaNode.filename = params.filename;

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: params.to,
    type: params.mediaType,
    [params.mediaType]: mediaNode,
    ...(params.replyToMetaMessageId ? { context: { message_id: params.replyToMetaMessageId } } : {}),
  };
  const res = await metaRequest<MetaSendResponse>((client) =>
    client.post(`/${creds.phoneNumberId}/messages`, body, authConfig(creds.accessToken)),
  );
  return extractResult(res);
}

/** Meta's reaction message type — official, documented Cloud API behavior, not an invented endpoint. */
export async function sendReaction(creds: MetaCredentials, params: SendReactionParams): Promise<MetaSendResult> {
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: params.to,
    type: 'reaction',
    reaction: { message_id: params.reactToMetaMessageId, emoji: params.emoji },
  };
  const res = await metaRequest<MetaSendResponse>((client) =>
    client.post(`/${creds.phoneNumberId}/messages`, body, authConfig(creds.accessToken)),
  );
  return extractResult(res);
}

export async function markAsRead(creds: MetaCredentials, metaMessageId: string): Promise<void> {
  const body = { messaging_product: 'whatsapp', status: 'read', message_id: metaMessageId };
  await metaRequest<unknown>((client) =>
    client.post(`/${creds.phoneNumberId}/messages`, body, authConfig(creds.accessToken)),
  );
}
