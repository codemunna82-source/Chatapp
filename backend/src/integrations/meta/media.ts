import FormData from 'form-data';
import { metaRequest, authConfig } from './metaClient';
import type { MetaCredentials, UploadMediaParams, UploadMediaResult, RetrieveMediaResult } from './types';

interface MetaMediaUploadResponse {
  id: string;
}

interface MetaMediaLookupResponse {
  messaging_product: 'whatsapp';
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number;
  id: string;
}

export async function uploadMedia(creds: MetaCredentials, params: UploadMediaParams): Promise<UploadMediaResult> {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', params.mimeType);
  form.append('file', params.buffer, { filename: params.filename ?? 'upload.bin', contentType: params.mimeType });

  const res = await metaRequest<MetaMediaUploadResponse>((client) =>
    client.post(
      `/${creds.phoneNumberId}/media`,
      form,
      authConfig(creds.accessToken, { headers: form.getHeaders() }),
    ),
  );
  return { metaMediaId: res.id };
}

export async function retrieveMedia(creds: MetaCredentials, metaMediaId: string): Promise<RetrieveMediaResult> {
  const res = await metaRequest<MetaMediaLookupResponse>((client) =>
    client.get(`/${metaMediaId}`, authConfig(creds.accessToken)),
  );
  return {
    metaMediaId: res.id,
    url: res.url,
    mimeType: res.mime_type,
    sha256: res.sha256,
    fileSizeBytes: res.file_size,
  };
}

/**
 * Meta's media URLs are short-lived and themselves require the same bearer
 * token to fetch — this is why media retrieval must be proxied through our
 * backend (architecture doc §4): the token can never be handed to Android.
 */
export async function downloadMediaBinary(creds: MetaCredentials, url: string): Promise<Buffer> {
  const data = await metaRequest<ArrayBuffer>((client) =>
    client.get(url, authConfig(creds.accessToken, { responseType: 'arraybuffer', baseURL: '' })),
  );
  return Buffer.from(data);
}
