import { v2 as cloudinary, type UploadApiOptions } from 'cloudinary';
import axios from 'axios';
import { env } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Cloudinary-backed object storage for two things this project previously
 * had none for (see media.model.ts's old "no object storage configured"
 * comment):
 *   1. Profile avatars — replaces storing raw image bytes inline on the
 *      User document.
 *   2. A persistent cache of WhatsApp media bytes — Meta's own media
 *      ids/links expire after ~30 days and every proxied fetch otherwise
 *      re-hits Meta's Graph API, so this is a real durability + latency
 *      win, not just decoration.
 *
 * Entirely optional: every caller checks isCloudinaryConfigured() first
 * and falls back to the prior behavior (Mongo-inline avatar bytes / a
 * fresh Meta fetch) when CLOUDINARY_URL isn't set, so a deployment with no
 * Cloudinary account configured loses nothing it had before.
 */

let configured = false;
let configFailed = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  if (configFailed) return false;
  if (!env.CLOUDINARY_URL) return false;

  // The Cloudinary SDK can auto-parse CLOUDINARY_URL out of process.env,
  // but this project routes every env access through the validated env
  // object (config/env.ts) instead of raw process.env — so it's parsed
  // explicitly here rather than relying on that implicit global read.
  let parsed: URL;
  try {
    parsed = new URL(env.CLOUDINARY_URL);
  } catch {
    logger.warn('CLOUDINARY_URL is not a valid URL — Cloudinary media storage disabled.');
    configFailed = true;
    return false;
  }
  if (parsed.protocol !== 'cloudinary:' || !parsed.username || !parsed.password || !parsed.hostname) {
    logger.warn(
      'CLOUDINARY_URL is malformed (expected cloudinary://<api_key>:<api_secret>@<cloud_name>) — Cloudinary media storage disabled.',
    );
    configFailed = true;
    return false;
  }

  cloudinary.config({
    cloud_name: parsed.hostname,
    api_key: decodeURIComponent(parsed.username),
    api_secret: decodeURIComponent(parsed.password),
    secure: true,
  });
  configured = true;
  return true;
}

export function isCloudinaryConfigured(): boolean {
  return ensureConfigured();
}

export interface CloudinaryUploadResult {
  url: string;
  publicId: string;
}

/** Uploads an in-memory buffer — every file this app handles is already fully read into memory by multer, never a local temp path. */
export async function uploadBufferToCloudinary(
  buffer: Buffer,
  opts: { folder: string; resourceType?: UploadApiOptions['resource_type'] },
): Promise<CloudinaryUploadResult> {
  if (!ensureConfigured()) {
    throw new Error('Cloudinary is not configured (CLOUDINARY_URL is unset)');
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: opts.folder, resource_type: opts.resourceType ?? 'auto', overwrite: false },
      (err, result) => {
        if (err || !result) {
          reject(err instanceof Error ? err : new Error('Cloudinary upload returned no result'));
          return;
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    stream.end(buffer);
  });
}

/** Downloads bytes from a Cloudinary URL server-side — the client never sees this URL directly, same "token/URL never reaches Android" boundary the Meta media proxy already enforces. */
/**
 * The same asset at a bounded width.
 *
 * Cloudinary resizes from the URL, so a thumbnail costs no extra storage
 * and no work here — the transformation goes in the path after /upload/.
 * `c_limit` never enlarges, so an image already smaller than the bound
 * comes back untouched rather than upscaled and blurry, and q_auto lets
 * Cloudinary pick the compression.
 *
 * A URL that is not a Cloudinary delivery URL is returned unchanged: the
 * caller then simply serves the original, which is correct, just larger.
 */
export function cloudinaryVariant(url: string, width: number): string {
  const marker = '/upload/';
  const at = url.indexOf(marker);
  if (at === -1) return url;
  return `${url.slice(0, at + marker.length)}c_limit,w_${width},q_auto/${url.slice(at + marker.length)}`;
}

export async function fetchCloudinaryBuffer(url: string): Promise<Buffer> {
  const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

/** Best-effort cleanup (e.g. replacing an old avatar) — never throws, a leftover orphaned asset isn't worth failing the calling request over. */
export async function deleteCloudinaryAsset(
  publicId: string,
  resourceType: UploadApiOptions['resource_type'] = 'image',
): Promise<void> {
  if (!ensureConfigured()) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (err) {
    logger.warn({ err, publicId }, 'Cloudinary asset delete failed (non-fatal)');
  }
}
