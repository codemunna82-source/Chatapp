import { Types } from 'mongoose';
import { Media, type MediaDoc, type MediaStatus } from './media.model';

export interface CreateMediaInput {
  tenantId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageRef: string;
  status?: MediaStatus;
  /** Known up-front for inbound (webhook-delivered) media; absent for a fresh outbound upload. */
  metaMediaId?: string;
}

export async function createMedia(input: CreateMediaInput): Promise<MediaDoc> {
  return Media.create(input);
}

export async function findMediaByIdAndTenant(id: string, tenantId: string): Promise<MediaDoc | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return Media.findOne({ _id: id, tenantId });
}

export async function markMediaReady(id: string, tenantId: string, metaMediaId: string): Promise<MediaDoc | null> {
  return Media.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: { status: 'READY', metaMediaId } },
    { new: true },
  );
}

export async function findMediaBySha256(tenantId: string, sha256: string): Promise<MediaDoc | null> {
  return Media.findOne({ tenantId, sha256, status: 'READY' });
}
