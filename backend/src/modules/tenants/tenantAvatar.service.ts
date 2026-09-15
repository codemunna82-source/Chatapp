import { ApiError } from '../../lib/ApiError';
import { fetchCloudinaryBuffer } from '../../integrations/cloudinary';
import { recordAudit } from '../audit/auditLog.service';
import {
  assertUsableAvatar,
  forgetPreviousAvatar,
  uploadBufferToCloudinary,
} from '../media/avatarAsset';
import { Tenant } from './tenant.model';

/**
 * The workspace's photo — what a customer sees at the top of the web chat
 * window.
 *
 * The window had a name and no picture, so every business looked like a
 * grey circle with a letter in it. On a page whose entire job is
 * persuading a stranger it is safe to keep talking, that is not a small
 * omission: a photo is most of what makes a chat window look like a
 * business rather than a form.
 */

/** Just the reference, which is select:false on the document. */
async function avatarRef(
  tenantId: string,
): Promise<{ url: string; contentType: string; cloudinaryPublicId?: string } | null> {
  const tenant = await Tenant.findById(tenantId)
    .select('+avatarUrl +avatarContentType +avatarCloudinaryPublicId')
    .lean();
  if (!tenant?.avatarUrl) return null;
  return {
    url: tenant.avatarUrl,
    contentType: tenant.avatarContentType ?? 'image/jpeg',
    cloudinaryPublicId: tenant.avatarCloudinaryPublicId ?? undefined,
  };
}

export async function updateTenantAvatar(
  tenantId: string,
  actorUserId: string,
  data: Buffer,
  contentType: string,
): Promise<{ avatarUpdatedAt: string }> {
  assertUsableAvatar(data, contentType);

  const previous = await avatarRef(tenantId);
  const uploaded = await uploadBufferToCloudinary(data, {
    folder: `voxo/${tenantId}/business-avatar`,
    resourceType: 'image',
  });

  const tenant = await Tenant.findByIdAndUpdate(
    tenantId,
    {
      $set: {
        avatarUrl: uploaded.url,
        avatarContentType: contentType,
        avatarCloudinaryPublicId: uploaded.publicId,
        avatarUpdatedAt: new Date(),
      },
    },
    { new: true },
  )
    .select('avatarUpdatedAt')
    .lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Workspace not found');

  await forgetPreviousAvatar(previous?.cloudinaryPublicId);

  // Worth a line: this changes what every customer of this workspace sees
  // above their chat, and it is a MASTER_ADMIN-only action.
  await recordAudit({
    tenantId,
    actorUserId,
    action: 'tenant.avatar.updated',
    targetType: 'Tenant',
    targetId: tenantId,
  });

  return { avatarUpdatedAt: (tenant.avatarUpdatedAt ?? new Date()).toISOString() };
}

export async function removeTenantAvatar(tenantId: string, actorUserId: string): Promise<void> {
  const previous = await avatarRef(tenantId);
  // $unset rather than setting null: absent is what every reader already
  // treats as "no photo", and avatarUpdatedAt going away is what tells a
  // client to stop asking for one.
  await Tenant.findByIdAndUpdate(tenantId, {
    $unset: {
      avatarUrl: '',
      avatarContentType: '',
      avatarCloudinaryPublicId: '',
      avatarUpdatedAt: '',
    },
  });
  await forgetPreviousAvatar(previous?.cloudinaryPublicId);
  await recordAudit({
    tenantId,
    actorUserId,
    action: 'tenant.avatar.removed',
    targetType: 'Tenant',
    targetId: tenantId,
  });
}

/**
 * The bytes, proxied.
 *
 * Fetched server-side and served from here for the same reason every
 * other avatar is: the Cloudinary URL is never handed to a client, so
 * there is one place that decides who may see this and it is this
 * server. The guest route in particular must not leak a URL a link
 * holder could keep after their link is revoked.
 */
export async function getTenantAvatar(tenantId: string): Promise<{ data: Buffer; contentType: string }> {
  const avatar = await avatarRef(tenantId);
  if (!avatar) {
    throw ApiError.notFound('AVATAR_NOT_FOUND', 'No photo set for this workspace');
  }
  return { data: await fetchCloudinaryBuffer(avatar.url), contentType: avatar.contentType };
}

/** The cache-buster clients key their copy on, or null when there is no
 *  photo — which is what stops them asking for one at all. */
export async function tenantAvatarVersion(tenantId: string): Promise<string | null> {
  const tenant = await Tenant.findById(tenantId).select('avatarUpdatedAt').lean();
  return tenant?.avatarUpdatedAt ? tenant.avatarUpdatedAt.toISOString() : null;
}
